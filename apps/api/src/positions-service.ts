import { type DeviceAttributes, devices, eq, positions, sql, type Tx } from '@trackflow/db';
import { publishPosition } from './bus.js';
import { emitDeviceEvent } from './device-events.js';
import { type FiredAlert, evaluateGeofences } from './geofence-service.js';

export interface RecordPositionInput {
  deviceId: string;
  tenantId: string;
  imei: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number;
  gpsValid: boolean;
  satellites?: number;
  attributes?: DeviceAttributes;
  fixTime: Date;
  kind: string;
  alarmType?: string;
}

/** Merges new telemetry into the device's last_attributes snapshot. */
function mergedAttributes(prev: DeviceAttributes | null, next?: DeviceAttributes): DeviceAttributes | undefined {
  if (!next || Object.keys(next).length === 0) return undefined;
  return { ...(prev ?? {}), ...next };
}

/**
 * Inserts a position, refreshes the device's denormalized state (position +
 * telemetry), fans out live, and evaluates geofences. Runs on the caller's
 * transaction so it inherits the RLS context. Returns any alerts that fired.
 */
export async function recordPosition(tx: Tx, input: RecordPositionInput): Promise<FiredAlert[]> {
  const inserted = await tx
    .insert(positions)
    .values({
      deviceId: input.deviceId,
      tenantId: input.tenantId,
      lat: input.latitude,
      lon: input.longitude,
      speedKph: input.speedKph,
      course: input.course,
      gpsValid: input.gpsValid,
      satellites: input.satellites ?? null,
      attributes: input.attributes ?? null,
      fixTime: input.fixTime,
    })
    .onConflictDoNothing({ target: [positions.deviceId, positions.fixTime] })
    .returning({ id: positions.id });

  // Duplicate fix (device retransmission) — already processed; don't re-fire
  // alerts or re-bump device state.
  if (inserted.length === 0) return [];

  const [prev] = await tx
    .select({ a: devices.lastAttributes, online: devices.online, name: devices.name })
    .from(devices)
    .where(eq(devices.id, input.deviceId));
  const merged = mergedAttributes(prev?.a ?? null, input.attributes);

  await tx
    .update(devices)
    .set({
      lastLat: input.latitude,
      lastLon: input.longitude,
      lastSpeed: input.speedKph,
      lastCourse: input.course,
      lastFixTime: input.fixTime,
      lastSeen: sql`now()`,
      online: true,
      ...(merged ? { lastAttributes: merged } : {}),
    })
    .where(eq(devices.id, input.deviceId));

  if (prev && !prev.online) void emitDeviceEvent(input.tenantId, input.deviceId, prev.name, true);

  publishPosition(input.tenantId, {
    deviceId: input.deviceId,
    imei: input.imei,
    lat: input.latitude,
    lon: input.longitude,
    speedKph: input.speedKph,
    course: input.course,
    fixTime: input.fixTime.toISOString(),
    kind: input.kind,
    alarmType: input.alarmType,
    attributes: merged,
  });

  return evaluateGeofences(tx, {
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    lat: input.latitude,
    lon: input.longitude,
    fixTime: input.fixTime,
  });
}

/** Status-only update (telemetry without a GPS fix, e.g. a GT06 heartbeat). */
export async function updateDeviceTelemetry(
  tx: Tx,
  deviceId: string,
  tenantId: string,
  imei: string,
  attributes: DeviceAttributes,
): Promise<void> {
  const [prev] = await tx
    .select({ a: devices.lastAttributes, online: devices.online, name: devices.name })
    .from(devices)
    .where(eq(devices.id, deviceId));
  const merged = mergedAttributes(prev?.a ?? null, attributes);
  await tx
    .update(devices)
    .set({ lastSeen: sql`now()`, online: true, ...(merged ? { lastAttributes: merged } : {}) })
    .where(eq(devices.id, deviceId));
  if (prev && !prev.online) void emitDeviceEvent(tenantId, deviceId, prev.name, true);
  if (merged) {
    publishPosition(tenantId, {
      deviceId,
      imei,
      lat: 0,
      lon: 0,
      speedKph: 0,
      course: 0,
      fixTime: new Date().toISOString(),
      kind: 'status',
      attributes: merged,
    });
  }
}
