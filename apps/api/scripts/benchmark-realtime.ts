import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type RedisClientType } from 'redis';
import { BoundedEventQueue } from '../src/bounded-event-queue.js';
import {
  REALTIME_REDIS_CHANNEL,
  RealtimeBus,
  RedisRealtimeBroker,
  type PositionEvent,
} from '../src/bus.js';
import { closeRedisClient } from '../src/redis.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const clientCount = Number(process.env.REALTIME_CLIENTS ?? 50);
const initialEvents = Number(process.env.REALTIME_INITIAL_EVENTS ?? 200);
const reconnectClients = Number(process.env.REALTIME_RECONNECT_CLIENTS ?? Math.min(10, clientCount));
const reconnectCycles = Number(process.env.REALTIME_RECONNECT_CYCLES ?? 3);
const recoveryEvents = Number(process.env.REALTIME_RECOVERY_EVENTS ?? 10);
const slowBurstEvents = Number(process.env.REALTIME_SLOW_BURST ?? 320);
const mailboxCapacity = Number(process.env.REALTIME_MAILBOX_CAPACITY ?? 256);
const p95BudgetMs = Number(process.env.REALTIME_P95_BUDGET_MS ?? 0);
const maxLoss = Number(process.env.REALTIME_MAX_LOSS ?? 0);
const output = process.env.OUTPUT ?? 'benchmarks/results/realtime-local.json';
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputPath = path.isAbsolute(output) ? output : path.resolve(workspaceRoot, output);

for (const [name, value] of Object.entries({
  REALTIME_CLIENTS: clientCount,
  REALTIME_INITIAL_EVENTS: initialEvents,
  REALTIME_RECONNECT_CLIENTS: reconnectClients,
  REALTIME_RECONNECT_CYCLES: reconnectCycles,
  REALTIME_RECOVERY_EVENTS: recoveryEvents,
  REALTIME_SLOW_BURST: slowBurstEvents,
  REALTIME_MAILBOX_CAPACITY: mailboxCapacity,
  REALTIME_MAX_LOSS: maxLoss,
})) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
if (clientCount < 1) throw new Error('REALTIME_CLIENTS must be at least 1');
if (reconnectClients > clientCount) throw new Error('REALTIME_RECONNECT_CLIENTS cannot exceed REALTIME_CLIENTS');
if (mailboxCapacity < 1) throw new Error('REALTIME_MAILBOX_CAPACITY must be at least 1');
if (slowBurstEvents <= mailboxCapacity) {
  throw new Error('REALTIME_SLOW_BURST must exceed REALTIME_MAILBOX_CAPACITY to exercise overflow');
}

interface QueueItem {
  sequence: number;
}

interface ConsumerSession {
  queue: BoundedEventQueue<QueueItem>;
  closed: boolean;
  task: Promise<void>;
}

class MeasuredClient {
  readonly expected = new Set<number>();
  readonly received = new Map<number, number>();
  readonly latencyBySequence = new Map<number, number>();
  readonly reconnectLatencyMs: number[] = [];
  healthyMailboxOverflows = 0;
  private session: ConsumerSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private reconnectTarget: { sequence: number; startedAtMs: number } | null = null;

  constructor(
    readonly id: string,
    private readonly sentAtMs: Map<number, number>,
  ) {}

  connect(bus: RealtimeBus, tenantId: string, firstSequence?: number): void {
    if (this.session || this.unsubscribe) throw new Error(`${this.id} is already connected`);
    const queue = new BoundedEventQueue<QueueItem>(mailboxCapacity);
    const session: ConsumerSession = { queue, closed: false, task: Promise.resolve() };
    if (firstSequence !== undefined) {
      this.reconnectTarget = { sequence: firstSequence, startedAtMs: performance.now() };
    }
    session.task = (async () => {
      while (!session.closed) {
        const item = await queue.next(100);
        if (!item) continue;
        const sentAt = this.sentAtMs.get(item.sequence);
        if (sentAt !== undefined) this.latencyBySequence.set(item.sequence, performance.now() - sentAt);
        this.received.set(item.sequence, (this.received.get(item.sequence) ?? 0) + 1);
        if (this.reconnectTarget?.sequence === item.sequence) {
          this.reconnectLatencyMs.push(performance.now() - this.reconnectTarget.startedAtMs);
          this.reconnectTarget = null;
        }
      }
    })();
    this.session = session;
    this.unsubscribe = bus.subscribePositions(tenantId, (event) => {
      const sequence = event.attributes?.benchmarkSequence;
      if (typeof sequence !== 'number' || !queue.push({ sequence })) this.healthyMailboxOverflows += 1;
    });
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const session = this.session;
    this.session = null;
    if (!session) return;
    session.closed = true;
    session.queue.close();
    await session.task;
  }

  isConnected(): boolean {
    return this.unsubscribe !== null;
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(values: number[]) {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    samples: values.length,
    min: values.length > 0 ? Math.min(...values) : null,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length > 0 ? Math.max(...values) : null,
    mean: values.length > 0 ? sum / values.length : null,
  };
}

async function redisSubscriberCount(client: RedisClientType): Promise<number> {
  const response = (await client.sendCommand(['PUBSUB', 'NUMSUB', REALTIME_REDIS_CHANNEL])) as Array<string | number>;
  const count = Number(response.at(-1));
  if (!Number.isFinite(count)) throw new Error(`Unexpected PUBSUB NUMSUB response: ${JSON.stringify(response)}`);
  return count;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 15_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await predicate())) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(10);
  }
}

const runId = randomUUID();
const tenantId = `synthetic-realtime-${runId}`;
const otherTenantId = `synthetic-realtime-other-${runId}`;
const sentAtMs = new Map<number, number>();
const clients = Array.from({ length: clientCount }, (_, index) => new MeasuredClient(`client-${index + 1}`, sentAtMs));
const reconnecting = clients.slice(0, reconnectClients);
const failures: string[] = [];
const initialSequences = new Set<number>();
const slowBurstSequences = new Set<number>();
let sequence = 0;
let published = 0;
let publishDurationMs = 0;
let crossTenantDeliveries = 0;
let slowAttempts = 0;
let slowOverflowAt: number | null = null;
let slowDisconnected = false;
let baselineRedisSubscribers: number | null = null;
let activeRedisSubscribers: number | null = null;
let finalRedisSubscribers: number | null = null;
let cleanupError: string | null = null;

const inspector = createClient({ url: redisUrl });
inspector.on('error', () => undefined);
const replicaA = new RealtimeBus(new RedisRealtimeBroker(redisUrl));
const replicaB = new RealtimeBus(new RedisRealtimeBroker(redisUrl));
let otherTenantUnsubscribe: (() => void) | null = null;
let slowUnsubscribe: (() => void) | null = null;
const slowQueue = new BoundedEventQueue<QueueItem>(mailboxCapacity);

function allExpectedDelivered(): boolean {
  return clients.every((client) => [...client.expected].every((item) => client.received.has(item)));
}

async function publishPosition(track?: Set<number>): Promise<number> {
  sequence += 1;
  const current = sequence;
  track?.add(current);
  for (const client of clients) {
    if (client.isConnected()) client.expected.add(current);
  }
  sentAtMs.set(current, performance.now());
  await replicaA.publishPosition(tenantId, {
    deviceId: `synthetic-device-${runId}`,
    imei: '990000000000001',
    lat: 19.076,
    lon: 72.8777,
    speedKph: 32,
    course: 90,
    fixTime: new Date().toISOString(),
    kind: 'benchmark',
    attributes: { benchmarkSequence: current },
  } satisfies PositionEvent);
  published += 1;
  return current;
}

try {
  await inspector.connect();
  baselineRedisSubscribers = await redisSubscriberCount(inspector);
  await Promise.all([replicaA.ready(), replicaB.ready()]);
  await waitFor(
    async () => (await redisSubscriberCount(inspector)) === baselineRedisSubscribers! + 2,
    'both realtime replicas to subscribe',
  ).catch(async () => {
    activeRedisSubscribers = await redisSubscriberCount(inspector);
    throw new Error(`Expected ${baselineRedisSubscribers! + 2} Redis subscribers, saw ${activeRedisSubscribers}`);
  });
  activeRedisSubscribers = await redisSubscriberCount(inspector);

  for (const client of clients) client.connect(replicaB, tenantId);
  otherTenantUnsubscribe = replicaB.subscribePositions(otherTenantId, () => {
    crossTenantDeliveries += 1;
  });

  const publishStartedAt = performance.now();
  for (let index = 0; index < initialEvents; index += 1) await publishPosition(initialSequences);
  await waitFor(allExpectedDelivered, 'initial fan-out deliveries');

  for (let cycle = 0; cycle < reconnectCycles; cycle += 1) {
    await Promise.all(reconnecting.map((client) => client.disconnect()));
    await publishPosition();
    await waitFor(allExpectedDelivered, `stable-client gap delivery in reconnect cycle ${cycle + 1}`);
    const firstRecoverySequence = sequence + 1;
    for (const client of reconnecting) client.connect(replicaB, tenantId, firstRecoverySequence);
    for (let index = 0; index < recoveryEvents; index += 1) await publishPosition();
    await waitFor(allExpectedDelivered, `recovery deliveries in reconnect cycle ${cycle + 1}`);
  }

  slowUnsubscribe = replicaB.subscribePositions(tenantId, (event) => {
    const item = event.attributes?.benchmarkSequence;
    if (typeof item !== 'number') return;
    slowAttempts += 1;
    if (!slowQueue.push({ sequence: item }) && slowOverflowAt === null) {
      slowOverflowAt = slowAttempts;
      slowDisconnected = true;
      slowUnsubscribe?.();
      slowUnsubscribe = null;
      slowQueue.close();
    }
  });
  for (let index = 0; index < slowBurstEvents; index += 1) await publishPosition(slowBurstSequences);
  await waitFor(allExpectedDelivered, 'healthy clients during slow-consumer pressure');
  publishDurationMs = performance.now() - publishStartedAt;
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  slowUnsubscribe?.();
  slowQueue.close();
  otherTenantUnsubscribe?.();
  try {
    await Promise.all(clients.map((client) => client.disconnect()));
    await Promise.all([replicaA.close(), replicaB.close()]);
    await closeRedisClient();
    if (inspector.isOpen) {
      await waitFor(async () => (await redisSubscriberCount(inspector)) === baselineRedisSubscribers, 'Redis subscriber cleanup');
      finalRedisSubscribers = await redisSubscriberCount(inspector);
      await inspector.quit();
    }
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : String(error);
    if (inspector.isOpen) await inspector.disconnect().catch(() => undefined);
  }
}

const latencySamples = clients.flatMap((client) => [...client.latencyBySequence.values()]);
const reconnectLatencySamples = clients.flatMap((client) => client.reconnectLatencyMs);
const healthyMailboxOverflows = clients.reduce((total, client) => total + client.healthyMailboxOverflows, 0);
let expectedDeliveries = 0;
let receivedDeliveries = 0;
let missingDeliveries = 0;
let duplicateDeliveries = 0;
let unexpectedDeliveries = 0;
let slowPressureMissingDeliveries = 0;
for (const client of clients) {
  expectedDeliveries += client.expected.size;
  for (const expected of client.expected) {
    const count = client.received.get(expected) ?? 0;
    if (count === 0) missingDeliveries += 1;
    if (slowBurstSequences.has(expected) && count === 0) slowPressureMissingDeliveries += 1;
  }
  for (const [received, count] of client.received) {
    receivedDeliveries += count;
    if (!client.expected.has(received)) unexpectedDeliveries += count;
    if (count > 1) duplicateDeliveries += count - 1;
  }
}

const latency = summarize(latencySamples);
const reconnectLatency = summarize(reconnectLatencySamples);
if (missingDeliveries > maxLoss) failures.push(`${missingDeliveries} healthy-client deliveries missing; budget is ${maxLoss}`);
if (duplicateDeliveries > 0) failures.push(`${duplicateDeliveries} duplicate healthy-client deliveries`);
if (unexpectedDeliveries > 0) failures.push(`${unexpectedDeliveries} deliveries arrived while clients were disconnected`);
if (healthyMailboxOverflows > 0) failures.push(`${healthyMailboxOverflows} healthy-client mailbox overflows`);
if (crossTenantDeliveries > 0) failures.push(`${crossTenantDeliveries} cross-tenant deliveries`);
if (!slowDisconnected || slowOverflowAt !== mailboxCapacity + 1) {
  failures.push(`slow consumer did not disconnect at mailbox overflow (${slowOverflowAt ?? 'no overflow'})`);
}
if (slowPressureMissingDeliveries > maxLoss) {
  failures.push(`${slowPressureMissingDeliveries} healthy deliveries missing during slow-consumer pressure`);
}
if (reconnectLatencySamples.length !== reconnectClients * reconnectCycles) {
  failures.push(`expected ${reconnectClients * reconnectCycles} reconnect samples, saw ${reconnectLatencySamples.length}`);
}
if (p95BudgetMs > 0 && latency.p95 !== null && latency.p95 > p95BudgetMs) {
  failures.push(`delivery p95 ${latency.p95.toFixed(1)}ms exceeds ${p95BudgetMs}ms`);
}
if (baselineRedisSubscribers === null || finalRedisSubscribers !== baselineRedisSubscribers || cleanupError) {
  failures.push(`Redis subscriber cleanup failed (${cleanupError ?? `${baselineRedisSubscribers} -> ${finalRedisSubscribers}`})`);
}

const result = {
  schemaVersion: 1,
  kind: 'trackflow.realtime',
  generatedAt: new Date().toISOString(),
  evidence: {
    scope: 'local-synthetic',
    productionClaim: false,
    note: 'Two in-process API replicas use real local Redis and the production realtime bus/mailbox. Excludes hosted network, proxy, failover, and browser rendering effects.',
  },
  runId,
  generator: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  config: {
    redisUrl: redisUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:[redacted]@'),
    clientCount,
    initialEvents,
    reconnectClients,
    reconnectCycles,
    recoveryEvents,
    slowBurstEvents,
    mailboxCapacity,
    budgets: { deliveryP95Ms: p95BudgetMs, maxLoss },
  },
  measurements: {
    publishedEvents: published,
    publishDurationMs,
    publishRatePerSecond: publishDurationMs > 0 ? (published / publishDurationMs) * 1000 : 0,
    fanout: {
      initialEvents: initialSequences.size,
      clients: clientCount,
      expectedDeliveries,
      receivedDeliveries,
      missingDeliveries,
      duplicateDeliveries,
      unexpectedDeliveries,
      healthyMailboxOverflows,
      deliveryLatencyMs: latency,
    },
    reconnect: {
      clients: reconnectClients,
      cycles: reconnectCycles,
      recoveryEventsPerCycle: recoveryEvents,
      firstEventLatencyMs: reconnectLatency,
    },
    slowConsumer: {
      mailboxCapacity,
      overflowAttempt: slowOverflowAt,
      disconnected: slowDisconnected,
      healthyMissingDeliveriesDuringPressure: slowPressureMissingDeliveries,
    },
    tenantIsolation: { crossTenantDeliveries },
    redisSubscribers: {
      baseline: baselineRedisSubscribers,
      withTwoReplicas: activeRedisSubscribers,
      afterCleanup: finalRedisSubscribers,
    },
  },
  cleanup: {
    attempted: true,
    redisSubscriberBaselineRestored: finalRedisSubscribers === baselineRedisSubscribers,
    error: cleanupError,
  },
  latencySamplesMs: latencySamples,
  failures,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    published,
    fanout: {
      expected: expectedDeliveries,
      received: receivedDeliveries,
      missing: missingDeliveries,
      duplicates: duplicateDeliveries,
      p50Ms: latency.p50,
      p95Ms: latency.p95,
      p99Ms: latency.p99,
    },
    reconnect: { samples: reconnectLatency.samples, p95Ms: reconnectLatency.p95 },
    slowConsumer: { overflowAttempt: slowOverflowAt, healthyMissing: slowPressureMissingDeliveries },
    crossTenantDeliveries,
    redisSubscribers: { baselineRedisSubscribers, activeRedisSubscribers, finalRedisSubscribers },
    failures,
  }),
);
if (failures.length > 0) process.exitCode = 1;
