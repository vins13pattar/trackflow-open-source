import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { RedisClientType } from 'redis';
import { env } from './env.js';
import { redisClient } from './redis.js';

export interface PositionEvent {
  deviceId: string;
  imei: string;
  lat: number;
  lon: number;
  speedKph: number;
  course: number;
  fixTime: string;
  kind: string;
  alarmType?: string;
  attributes?: Record<string, number | boolean | string>;
}

export interface AlertEvent {
  id: string;
  deviceId: string;
  geofenceId: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  lat: number | null;
  lon: number | null;
  createdAt: string;
}

type RealtimeKind = 'position' | 'alert';
type RealtimeEvent = PositionEvent | AlertEvent;

interface RealtimeEnvelope {
  version: 1;
  sourceId: string;
  tenantId: string;
  kind: RealtimeKind;
  event: RealtimeEvent;
}

export interface RealtimeBroker {
  publish(message: string): Promise<void>;
  subscribe(onMessage: (message: string) => void): Promise<() => Promise<void>>;
}

export const REALTIME_REDIS_CHANNEL = 'trackflow:realtime:v1';

/** Provider-neutral Redis pub/sub adapter. A duplicate connection is required
 * because a subscribed Redis connection cannot also issue regular commands. */
export class RedisRealtimeBroker implements RealtimeBroker {
  constructor(private readonly url: string) {}

  async publish(message: string): Promise<void> {
    await (await redisClient(this.url)).publish(REALTIME_REDIS_CHANNEL, message);
  }

  async subscribe(onMessage: (message: string) => void): Promise<() => Promise<void>> {
    const subscriber = (await redisClient(this.url)).duplicate() as RedisClientType;
    subscriber.on('error', (error) => console.error('[realtime] subscriber error', error));
    await subscriber.connect();
    await subscriber.subscribe(REALTIME_REDIS_CHANNEL, onMessage);
    return async () => {
      if (subscriber.isOpen) {
        await subscriber.unsubscribe(REALTIME_REDIS_CHANNEL);
        await subscriber.quit();
      }
    };
  }
}

/** Fan-out bus with local delivery plus an optional shared broker. Locally
 * emitted events are tagged so the publishing replica ignores its Redis echo. */
export class RealtimeBus {
  private readonly emitter = new EventEmitter();
  private readonly sourceId = randomUUID();
  private brokerReady: Promise<void> | null = null;
  private brokerUnsubscribe: (() => Promise<void>) | null = null;

  constructor(private readonly broker?: RealtimeBroker) {
    this.emitter.setMaxListeners(0);
  }

  private channel(kind: RealtimeKind, tenantId: string): string {
    return `${kind}:${tenantId}`;
  }

  private ensureBrokerSubscription(): Promise<void> {
    if (!this.broker) return Promise.resolve();
    this.brokerReady ??= this.broker
      .subscribe((message) => {
        let envelope: RealtimeEnvelope;
        try {
          envelope = JSON.parse(message) as RealtimeEnvelope;
        } catch {
          return;
        }
        if (
          envelope.version !== 1 ||
          envelope.sourceId === this.sourceId ||
          !envelope.tenantId ||
          (envelope.kind !== 'position' && envelope.kind !== 'alert') ||
          typeof envelope.event !== 'object' ||
          envelope.event === null
        ) {
          return;
        }
        this.emitter.emit(this.channel(envelope.kind, envelope.tenantId), envelope.event);
      })
      .then((unsubscribe) => {
        this.brokerUnsubscribe = unsubscribe;
      });
    return this.brokerReady;
  }

  /** Resolves once this replica is listening on the shared broker. */
  ready(): Promise<void> {
    return this.ensureBrokerSubscription();
  }

  async publishPosition(tenantId: string, event: PositionEvent): Promise<void> {
    await this.publish('position', tenantId, event);
  }

  async publishAlert(tenantId: string, event: AlertEvent): Promise<void> {
    await this.publish('alert', tenantId, event);
  }

  private async publish(kind: RealtimeKind, tenantId: string, event: RealtimeEvent): Promise<void> {
    this.emitter.emit(this.channel(kind, tenantId), event);
    if (!this.broker) return;
    await this.broker.publish(JSON.stringify({ version: 1, sourceId: this.sourceId, tenantId, kind, event } satisfies RealtimeEnvelope));
  }

  subscribePositions(tenantId: string, cb: (event: PositionEvent) => void): () => void {
    return this.subscribe('position', tenantId, cb as (event: RealtimeEvent) => void);
  }

  subscribeAlerts(tenantId: string, cb: (event: AlertEvent) => void): () => void {
    return this.subscribe('alert', tenantId, cb as (event: RealtimeEvent) => void);
  }

  private subscribe(kind: RealtimeKind, tenantId: string, cb: (event: RealtimeEvent) => void): () => void {
    const channel = this.channel(kind, tenantId);
    this.emitter.on(channel, cb);
    void this.ensureBrokerSubscription().catch((error) => console.error('[realtime] broker unavailable', error));
    return () => this.emitter.off(channel, cb);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    await this.brokerUnsubscribe?.();
    this.brokerUnsubscribe = null;
    this.brokerReady = null;
  }
}

const bus = new RealtimeBus(env.redisUrl ? new RedisRealtimeBroker(env.redisUrl) : undefined);

export function publishPosition(tenantId: string, event: PositionEvent): void {
  void bus.publishPosition(tenantId, event).catch((error) => console.error('[realtime] position publish failed', error));
}

export function subscribePositions(tenantId: string, cb: (event: PositionEvent) => void): () => void {
  return bus.subscribePositions(tenantId, cb);
}

export function publishAlert(tenantId: string, event: AlertEvent): void {
  void bus.publishAlert(tenantId, event).catch((error) => console.error('[realtime] alert publish failed', error));
}

export function subscribeAlerts(tenantId: string, cb: (event: AlertEvent) => void): () => void {
  return bus.subscribeAlerts(tenantId, cb);
}
