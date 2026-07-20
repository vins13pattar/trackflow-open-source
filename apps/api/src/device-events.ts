import { alerts, and, devices, eq, lt, sql, withSystem } from '@trackflow/db';
import { type AlertEvent, publishAlert } from './bus.js';
import { db } from './db.js';
import { deliverEvent } from './webhook-service.js';

const OFFLINE_THRESHOLD_MS = Number(process.env.OFFLINE_THRESHOLD_MS ?? 5 * 60 * 1000);

/** Records a device.online/offline event: alert row + live SSE + webhook fan-out. */
export async function emitDeviceEvent(
  tenantId: string,
  deviceId: string,
  deviceName: string,
  online: boolean,
): Promise<void> {
  const type = online ? 'device_online' : 'device_offline';
  const title = online ? 'Device online' : 'Device offline';
  const message = `${deviceName} is ${online ? 'back online' : 'offline (no data)'}`;
  const severity = online ? 'low' : 'high';

  const [row] = await withSystem(db, (tx) =>
    tx.insert(alerts).values({ tenantId, deviceId, type, severity, title, message }).returning({ id: alerts.id, createdAt: alerts.createdAt }),
  );
  const event: AlertEvent = {
    id: row!.id,
    deviceId,
    geofenceId: null,
    type,
    severity,
    title,
    message,
    lat: null,
    lon: null,
    createdAt: row!.createdAt.toISOString(),
  };
  publishAlert(tenantId, event);
  void deliverEvent(tenantId, online ? 'device.online' : 'device.offline', event);
}

/** Flips devices that stopped reporting to offline and fires device.offline. */
export async function sweepOffline(thresholdMs = OFFLINE_THRESHOLD_MS): Promise<void> {
  const cutoff = new Date(Date.now() - thresholdMs);
  const stale = await withSystem(db, (tx) =>
    tx
      .select({ id: devices.id, tenantId: devices.tenantId, name: devices.name })
      .from(devices)
      .where(and(eq(devices.online, true), lt(devices.lastSeen, cutoff))),
  );
  for (const d of stale) {
    await withSystem(db, (tx) => tx.update(devices).set({ online: false }).where(eq(devices.id, d.id)));
    await emitDeviceEvent(d.tenantId, d.id, d.name, false);
  }
}

/** Starts the periodic offline sweep (in-process; single instance). */
export function startOfflineSweep(intervalMs = Number(process.env.OFFLINE_SWEEP_MS ?? 60_000)): NodeJS.Timeout {
  return setInterval(() => {
    void sweepOffline().catch((err) => console.warn('[sweep] offline sweep failed:', (err as Error).message));
  }, intervalMs);
}
