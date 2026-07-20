import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for live fan-out to dashboard SSE clients. Dev stand-in for
 * the production path (Durable Objects / Redis pub/sub). Keyed by tenant.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

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

const positionChannel = (tenantId: string) => `pos:${tenantId}`;
const alertChannel = (tenantId: string) => `alert:${tenantId}`;

export function publishPosition(tenantId: string, event: PositionEvent): void {
  emitter.emit(positionChannel(tenantId), event);
}
export function subscribePositions(tenantId: string, cb: (e: PositionEvent) => void): () => void {
  const ch = positionChannel(tenantId);
  emitter.on(ch, cb);
  return () => emitter.off(ch, cb);
}

export function publishAlert(tenantId: string, event: AlertEvent): void {
  emitter.emit(alertChannel(tenantId), event);
}
export function subscribeAlerts(tenantId: string, cb: (e: AlertEvent) => void): () => void {
  const ch = alertChannel(tenantId);
  emitter.on(ch, cb);
  return () => emitter.off(ch, cb);
}
