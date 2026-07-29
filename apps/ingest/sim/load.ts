/**
 * Synthetic multi-protocol TCP load generator.
 *
 * Examples:
 *   pnpm ingest:load -- --devices=100 --duration=30
 *   SIM_PROTOCOLS=gt06,h02,teltonika,nmea pnpm ingest:load -- --devices=1000
 *
 * Results are written as versioned JSON under benchmarks/results/. No real
 * device identities or locations are used.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  encodeGt06Location,
  encodeGt06Login,
  encodeH02Location,
  encodeNmeaIdentity,
  encodeNmeaRmc,
  encodeTeltonikaAvl,
  encodeTeltonikaImei,
} from '@trackflow/protocols';

type Protocol = 'gt06' | 'h02' | 'teltonika' | 'nmea';
const ALL_PROTOCOLS: Protocol[] = ['gt06', 'h02', 'teltonika', 'nmea'];

function cli(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, envName: string, fallback: number): number {
  const value = Number(cli(name) ?? process.env[envName] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function rateOption(name: string, envName: string, fallback: number): number {
  const value = numberOption(name, envName, fallback);
  if (value > 1) throw new Error(`${name} must be between 0 and 1`);
  return value;
}

const protocols = (cli('protocols') ?? process.env.SIM_PROTOCOLS ?? ALL_PROTOCOLS.join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean) as Protocol[];
if (protocols.length === 0 || protocols.some((protocol) => !ALL_PROTOCOLS.includes(protocol))) {
  throw new Error(`protocols must be a comma-separated subset of ${ALL_PROTOCOLS.join(',')}`);
}

const config = {
  host: cli('host') ?? process.env.SIM_HOST ?? '127.0.0.1',
  metricsUrl: cli('metrics-url') ?? process.env.SIM_METRICS_URL ?? 'http://127.0.0.1:9100/metrics',
  devices: numberOption('devices', 'SIM_DEVICES', 100),
  durationSeconds: numberOption('duration', 'SIM_DURATION_SECONDS', 30),
  intervalMs: numberOption('interval', 'SIM_INTERVAL_MS', 1_000),
  connectionRate: numberOption('connection-rate', 'SIM_CONNECTION_RATE', 250),
  jitterMs: numberOption('jitter', 'SIM_JITTER_MS', 50),
  clockDriftMs: numberOption('clock-drift', 'SIM_CLOCK_DRIFT_MS', 0),
  burstSize: numberOption('burst-size', 'SIM_BURST_SIZE', 1),
  invalidRate: rateOption('invalid-rate', 'SIM_INVALID_RATE', 0.001),
  fragmentRate: rateOption('fragment-rate', 'SIM_FRAGMENT_RATE', 0.1),
  duplicateRate: rateOption('duplicate-rate', 'SIM_DUPLICATE_RATE', 0.01),
  outOfOrderRate: rateOption('out-of-order-rate', 'SIM_OUT_OF_ORDER_RATE', 0.01),
  churnRate: rateOption('churn-rate', 'SIM_CHURN_RATE', 0),
  ungracefulRate: rateOption('ungraceful-rate', 'SIM_UNGRACEFUL_RATE', 0.25),
  reconnectBaseMs: numberOption('reconnect-base', 'SIM_RECONNECT_BASE_MS', 100),
  reconnectMaxMs: numberOption('reconnect-max', 'SIM_RECONNECT_MAX_MS', 5_000),
  seed: numberOption('seed', 'SIM_SEED', 42),
  ports: {
    gt06: numberOption('gt06-port', 'SIM_GT06_PORT', 5023),
    h02: numberOption('h02-port', 'SIM_H02_PORT', 5013),
    teltonika: numberOption('teltonika-port', 'SIM_TELTONIKA_PORT', 5027),
    nmea: numberOption('nmea-port', 'SIM_NMEA_PORT', 5004),
  } satisfies Record<Protocol, number>,
};
if (config.devices < 1 || config.durationSeconds < 1 || config.intervalMs < 1 || config.connectionRate < 1 || config.burstSize < 1) {
  throw new Error('devices, duration, interval, connection-rate and burst-size must be at least 1');
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const random = mulberry32(config.seed);

const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : null);
  return { count: sorted.length, p50Ms: at(50), p95Ms: at(95), p99Ms: at(99), maxMs: sorted.at(-1) ?? null };
};

const metrics = {
  connectionAttempts: 0,
  connectionsEstablished: 0,
  activeConnections: 0,
  peakActiveConnections: 0,
  successfulHandshakes: 0,
  packetsSent: 0,
  bytesSent: 0,
  acknowledgementsReceived: 0,
  invalidPacketsSent: 0,
  fragmentedPacketsSent: 0,
  duplicatePacketsSent: 0,
  outOfOrderPacketsSent: 0,
  reconnectCount: 0,
  gracefulDisconnects: 0,
  ungracefulDisconnects: 0,
  errors: {} as Record<string, number>,
  connectionLatencyMs: [] as number[],
  acknowledgementLatencyMs: [] as number[],
  eventLoopLagMs: [] as number[],
  memoryRssBytes: [] as number[],
  cpuUserMicros: 0,
  cpuSystemMicros: 0,
};

function error(category: string): void {
  metrics.errors[category] = (metrics.errors[category] ?? 0) + 1;
}

function syntheticImei(index: number): string {
  return `990001${String(index).padStart(9, '0')}`;
}

function corrupt(frame: Buffer): Buffer {
  const bad = Buffer.from(frame);
  if (bad.length > 4) bad[Math.floor(bad.length / 2)]! ^= 0xff;
  return bad;
}

class Device {
  private socket: net.Socket | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private stopped = false;
  private everConnected = false;
  private reconnectAttempt = 0;
  private serial = 2;
  private lat: number;
  private lon: number;
  private course: number;
  private pendingAcks: number[] = [];
  private handshakePending = false;

  readonly imei: string;
  readonly protocol: Protocol;

  constructor(readonly index: number) {
    this.imei = syntheticImei(index);
    this.protocol = protocols[index % protocols.length]!;
    this.lat = 12.90 + (index % 100) * 0.001;
    this.lon = 77.50 + (Math.floor(index / 100) % 100) * 0.001;
    this.course = index % 360;
  }

  connect(): void {
    if (this.stopped) return;
    metrics.connectionAttempts += 1;
    const started = performance.now();
    const socket = net.connect(config.ports[this.protocol], config.host);
    this.socket = socket;

    socket.setNoDelay(true);
    socket.on('connect', () => {
      if (this.stopped || socket !== this.socket) return;
      this.connected = true;
      this.reconnectAttempt = 0;
      metrics.connectionsEstablished += 1;
      metrics.activeConnections += 1;
      metrics.peakActiveConnections = Math.max(metrics.peakActiveConnections, metrics.activeConnections);
      metrics.connectionLatencyMs.push(performance.now() - started);
      if (this.everConnected) metrics.reconnectCount += 1;
      this.everConnected = true;
      this.sendHandshake();
      this.tickTimer = setInterval(() => this.tick(), config.intervalMs);
      this.tick();
    });
    socket.on('data', () => {
      metrics.acknowledgementsReceived += 1;
      if (this.handshakePending) {
        this.handshakePending = false;
        metrics.successfulHandshakes += 1;
      }
      const sentAt = this.pendingAcks.shift();
      if (sentAt !== undefined) metrics.acknowledgementLatencyMs.push(performance.now() - sentAt);
    });
    socket.on('error', (cause) => error(`socket_${(cause as NodeJS.ErrnoException).code ?? 'error'}`));
    socket.on('close', () => {
      if (this.connected) {
        this.connected = false;
        metrics.activeConnections -= 1;
      }
      if (this.tickTimer) clearInterval(this.tickTimer);
      this.tickTimer = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  stop(graceful = true): void {
    this.stopped = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (!this.socket || this.socket.destroyed) return;
    if (graceful) {
      metrics.gracefulDisconnects += 1;
      this.socket.end();
    } else {
      metrics.ungracefulDisconnects += 1;
      this.socket.destroy();
    }
  }

  private sendHandshake(): void {
    if (this.protocol === 'gt06') {
      this.handshakePending = true;
      this.writeFrame(encodeGt06Login(this.imei, 1), true);
    } else if (this.protocol === 'teltonika') {
      this.handshakePending = true;
      this.writeFrame(encodeTeltonikaImei(this.imei), true);
    } else if (this.protocol === 'nmea') {
      this.writeFrame(encodeNmeaIdentity(this.imei), false);
      metrics.successfulHandshakes += 1;
    } else {
      // H02 carries the IMEI in every frame and has no separate handshake ACK.
      metrics.successfulHandshakes += 1;
    }
  }

  private tick(): void {
    if (!this.connected || this.stopped) return;
    if (random() < config.churnRate) {
      this.stopForReconnect(random() >= config.ungracefulRate);
      return;
    }

    for (let burst = 0; burst < config.burstSize; burst += 1) {
      const speedKph = 30 + random() * 30;
      this.course = (this.course + random() * 20 - 10 + 360) % 360;
      const distKm = (speedKph * (config.intervalMs / 1000)) / 3600;
      const rad = (this.course * Math.PI) / 180;
      this.lat += (distKm / 111) * Math.cos(rad);
      this.lon += (distKm / (111 * Math.cos((this.lat * Math.PI) / 180))) * Math.sin(rad);
      const outOfOrder = random() < config.outOfOrderRate;
      const time = new Date(Date.now() + config.clockDriftMs - (outOfOrder ? config.intervalMs * 2 : 0));
      if (outOfOrder) metrics.outOfOrderPacketsSent += 1;
      const frame = this.positionFrame(speedKph, time);
      const invalid = random() < config.invalidRate;
      const wire = invalid ? corrupt(frame) : frame;
      if (invalid) metrics.invalidPacketsSent += 1;
      this.writeFrame(wire, !invalid && (this.protocol === 'gt06' || this.protocol === 'teltonika'));
      if (random() < config.duplicateRate) {
        metrics.duplicatePacketsSent += 1;
        this.writeFrame(wire, this.protocol === 'gt06' || this.protocol === 'teltonika');
      }
    }
  }

  private positionFrame(speedKph: number, time: Date): Buffer {
    const input = { latitude: this.lat, longitude: this.lon, speedKph, course: this.course, time };
    if (this.protocol === 'gt06') return encodeGt06Location(input, this.serial++);
    if (this.protocol === 'h02') return encodeH02Location({ ...input, imei: this.imei });
    if (this.protocol === 'teltonika') return encodeTeltonikaAvl([{ ...input, ignition: true, gsmSignal: 4 }]);
    return encodeNmeaRmc(input);
  }

  private writeFrame(frame: Buffer, expectsAck: boolean): void {
    const socket = this.socket;
    if (!socket || socket.destroyed) return;
    metrics.packetsSent += 1;
    if (expectsAck) this.pendingAcks.push(performance.now());

    const write = () => {
      if (socket.destroyed || !socket.writable || socket.writableEnded) return;
      if (random() < config.fragmentRate && frame.length > 2) {
        metrics.fragmentedPacketsSent += 1;
        const split = 1 + Math.floor(random() * (frame.length - 1));
        socket.write(frame.subarray(0, split));
        metrics.bytesSent += split;
        setTimeout(() => {
          if (!socket.destroyed && socket.writable && !socket.writableEnded) {
            socket.write(frame.subarray(split));
            metrics.bytesSent += frame.length - split;
          }
        }, Math.max(1, Math.round(random() * config.jitterMs)));
      } else {
        socket.write(frame);
        metrics.bytesSent += frame.length;
      }
    };
    setTimeout(write, Math.round(random() * config.jitterMs));
  }

  private stopForReconnect(graceful: boolean): void {
    if (!this.socket) return;
    if (graceful) {
      metrics.gracefulDisconnects += 1;
      this.socket.end();
    } else {
      metrics.ungracefulDisconnects += 1;
      this.socket.destroy();
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    const backoff = Math.min(config.reconnectMaxMs, config.reconnectBaseMs * 2 ** (this.reconnectAttempt - 1));
    const jitter = Math.round(backoff * (0.5 + random()));
    this.reconnectTimer = setTimeout(() => this.connect(), jitter);
  }
}

const startedAt = new Date();
const startedCpu = process.cpuUsage();
let loopExpected = performance.now() + 1_000;
const resourceTimer = setInterval(() => {
  const now = performance.now();
  metrics.eventLoopLagMs.push(Math.max(0, now - loopExpected));
  loopExpected = now + 1_000;
  metrics.memoryRssBytes.push(process.memoryUsage().rss);
}, 1_000);

const devices = Array.from({ length: config.devices }, (_, index) => new Device(index + 1));
const rampDelayMs = 1_000 / config.connectionRate;
for (const device of devices) {
  device.connect();
  if (rampDelayMs >= 1) await new Promise((resolve) => setTimeout(resolve, rampDelayMs));
}

await new Promise((resolve) => setTimeout(resolve, config.durationSeconds * 1_000));
devices.forEach((device) => device.stop(random() >= config.ungracefulRate));
await new Promise((resolve) => setTimeout(resolve, 500));
clearInterval(resourceTimer);

const cpu = process.cpuUsage(startedCpu);
metrics.cpuUserMicros = cpu.user;
metrics.cpuSystemMicros = cpu.system;
const finishedAt = new Date();
const elapsedSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1_000;
const protocolMix = Object.fromEntries(protocols.map((protocol) => [protocol, devices.filter((device) => device.protocol === protocol).length]));
let ingestMetricsText: string | null = null;
try {
  const response = await fetch(config.metricsUrl, {
    headers: process.env.METRICS_TOKEN ? { authorization: `Bearer ${process.env.METRICS_TOKEN}` } : undefined,
  });
  if (response.ok) ingestMetricsText = await response.text();
  else error(`metrics_http_${response.status}`);
} catch {
  error('metrics_unreachable');
}
const result = {
  schemaVersion: 1,
  kind: 'trackflow-tcp-device-simulator',
  measurement: 'direct',
  measuredBoundary: 'simulator-to-tcp-ingest',
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  elapsedSeconds,
  environment: {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  workload: { ...config, protocols, protocolMix, syntheticDataOnly: true },
  measurements: {
    ...metrics,
    connectionLatency: percentiles(metrics.connectionLatencyMs),
    protocolAcknowledgementLatency: percentiles(metrics.acknowledgementLatencyMs),
    eventLoopLag: percentiles(metrics.eventLoopLagMs),
    maxMemoryRssBytes: Math.max(0, ...metrics.memoryRssBytes),
    packetsPerSecond: metrics.packetsSent / elapsedSeconds,
    bytesPerSecond: metrics.bytesSent / elapsedSeconds,
    ingestPrometheusText: ingestMetricsText,
  },
  limitations: [
    'Protocol acknowledgement latency is not database commit or ingest-to-map latency.',
    'Invalid-packet count is generator-side; server decode failures must be read from ingest metrics.',
    'Results describe this local environment only and must not be extrapolated without a separate capacity model.',
  ],
};

const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const outputArg = cli('output') ?? process.env.SIM_OUTPUT ?? `benchmarks/results/tcp-${config.devices}-${stamp}.json`;
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const output = path.isAbsolute(outputArg) ? outputArg : path.resolve(repoRoot, outputArg);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify({
    output,
    devices: config.devices,
    peakConnections: metrics.peakActiveConnections,
    packets: metrics.packetsSent,
    packetsPerSecond: Number((metrics.packetsSent / elapsedSeconds).toFixed(2)),
    errors: metrics.errors,
    ackP95Ms: result.measurements.protocolAcknowledgementLatency.p95Ms,
  }),
);
