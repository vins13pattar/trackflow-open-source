import { and, deviceCommands, devices, eq, isNotNull, lt, withSystem } from '@trackflow/db';
import { ackDeviceCommandSchema, errors, ingestPositionSchema, verifyToken } from '@trackflow/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { dispatchAlerts } from '../alert-dispatch.js';
import { subscribeAlerts, subscribePositions } from '../bus.js';
import { db } from '../db.js';
import { env } from '../env.js';
import { recordPosition, updateDeviceTelemetry } from '../positions-service.js';

/** Trusted ingest endpoint the TCP service posts to (shared-secret gated). */
export const internalRoutes = new Hono();

internalRoutes.post('/positions', async (c) => {
  if (c.req.header('x-ingest-token') !== env.ingestToken) throw errors.unauthorized();
  const body = ingestPositionSchema.parse(await c.req.json());
  const hasPosition = body.latitude != null && body.longitude != null;

  // Trusted system path: the IMEI->tenant lookup is cross-tenant by nature, so
  // it runs with RLS bypassed.
  const result = await withSystem(db, async (tx) => {
    const [device] = await tx
      .select({ id: devices.id, tenantId: devices.tenantId })
      .from(devices)
      .where(eq(devices.imei, body.imei));
    if (!device) return null;

    if (!hasPosition) {
      // Status-only packet (telemetry without a GPS fix).
      if (body.attributes) {
        await updateDeviceTelemetry(tx, device.id, device.tenantId, body.imei, body.attributes);
      }
      return { tenantId: device.tenantId, fired: [] };
    }

    const fired = await recordPosition(tx, {
      deviceId: device.id,
      tenantId: device.tenantId,
      imei: body.imei,
      latitude: body.latitude!,
      longitude: body.longitude!,
      speedKph: body.speedKph ?? 0,
      course: body.course ?? 0,
      gpsValid: body.gpsValid ?? true,
      satellites: body.satellites,
      attributes: body.attributes,
      fixTime: new Date(body.fixTime),
      kind: body.kind,
      alarmType: body.alarmType,
    });
    return { tenantId: device.tenantId, fired };
  });
  if (!result) return c.json({ skipped: true, reason: 'unknown_imei' }, 202);
  if (result.fired.length > 0) void dispatchAlerts(result.tenantId, result.fired);
  return c.json({ ok: true });
});

/** Live position stream for the dashboard (SSE; token via query for EventSource). */
export const realtimeRoutes = new Hono();

realtimeRoutes.get('/positions', async (c) => {
  const token = c.req.query('token');
  if (!token) throw errors.unauthorized();
  const claims = await verifyToken(token, 'access', env.jwt);

  return streamSSE(c, async (stream) => {
    const unsubPos = subscribePositions(claims.tid, (event) => {
      void stream.writeSSE({ event: 'position', data: JSON.stringify(event) });
    });
    const unsubAlert = subscribeAlerts(claims.tid, (event) => {
      void stream.writeSSE({ event: 'alert', data: JSON.stringify(event) });
    });
    const unsubscribe = () => {
      unsubPos();
      unsubAlert();
    };
    stream.onAbort(unsubscribe);
    // Heartbeat keeps proxies from closing the idle connection.
    while (!stream.aborted) {
      await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
      await stream.sleep(25_000);
    }
  });
});

// ---------- two-way command pickup (token-gated) ----------

/** Atomically claims and returns all queued commands for a device — the TCP
 *  ingest session calls this when the device connects, then sends each command
 *  back over the protocol-specific wire. */
internalRoutes.post('/devices/:id/commands/pending', async (c) => {
  if (c.req.header('x-ingest-token') !== env.ingestToken) throw errors.unauthorized();
  const deviceId = c.req.param('id');
  const now = new Date();
  const rows = await withSystem(db, async (tx) => {
    // Flag expired commands while we're here so they don't pile up.
    await tx
      .update(deviceCommands)
      .set({ status: 'expired' })
      .where(and(eq(deviceCommands.deviceId, deviceId), eq(deviceCommands.status, 'queued'), isNotNull(deviceCommands.expiresAt), lt(deviceCommands.expiresAt, now)));
    return tx
      .update(deviceCommands)
      .set({ status: 'sent', sentAt: now })
      .where(and(eq(deviceCommands.deviceId, deviceId), eq(deviceCommands.status, 'queued')))
      .returning();
  });
  return c.json({
    commands: rows.map((r) => ({ id: r.id, command: r.command, parameters: r.parameters, expiresAt: r.expiresAt?.toISOString() ?? null })),
  });
});

/** Device/ingest reports the result of a sent command. */
internalRoutes.post('/devices/commands/:cmdId/ack', async (c) => {
  if (c.req.header('x-ingest-token') !== env.ingestToken) throw errors.unauthorized();
  const cmdId = c.req.param('cmdId');
  const body = ackDeviceCommandSchema.parse(await c.req.json());
  const updated = await withSystem(db, async (tx) => {
    const [row] = await tx
      .update(deviceCommands)
      .set({ status: body.status, response: body.response ?? null, ackedAt: new Date() })
      .where(eq(deviceCommands.id, cmdId))
      .returning();
    return row;
  });
  if (!updated) throw errors.notFound('Command not found');
  return c.json({ ok: true, id: updated.id, status: updated.status });
});
