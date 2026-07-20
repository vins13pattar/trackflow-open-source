import { and, asc, desc, type DeviceCommand, deviceCommands, devices, eq, gte, lte, positions, trips, withTenant } from '@trackflow/db';
import type { Device } from '@trackflow/db';
import {
  createDeviceSchema,
  type DeviceStatus,
  type DeviceSummary,
  errors,
  queueDeviceCommandSchema,
  reportPositionSchema,
  updateDeviceSchema,
} from '@trackflow/shared';
import { Hono } from 'hono';
import { dispatchAlerts } from '../alert-dispatch.js';
import { assertDeviceQuota } from '../billing-service.js';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { lookupPresence } from '../presence.js';
import { recordPosition } from '../positions-service.js';

export const deviceRoutes = new Hono<AppEnv>();

function toSummary(d: Device): DeviceSummary {
  const hasPos = d.lastLat != null && d.lastLon != null;
  return {
    id: d.id,
    name: d.name,
    imei: d.imei,
    type: d.type,
    protocol: d.protocol,
    status: d.status as DeviceStatus,
    registrationNumber: d.registrationNumber,
    vehicleId: d.vehicleId,
    lastPosition: hasPos
      ? {
          latitude: d.lastLat!,
          longitude: d.lastLon!,
          speedKph: d.lastSpeed ?? 0,
          course: d.lastCourse ?? 0,
          fixTime: (d.lastFixTime ?? new Date()).toISOString(),
        }
      : null,
    lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
    attributes: d.lastAttributes ?? null,
  };
}

// RLS scopes every query to the principal's tenant; the explicit filters below
// are belt-and-suspenders.
deviceRoutes.get('/', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(devices).orderBy(asc(devices.name)),
  );
  return c.json({ devices: rows.map(toSummary), total: rows.length });
});

deviceRoutes.post('/', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = createDeviceSchema.parse(await c.req.json());
  try {
    const device = await withTenant(db, tenantId, async (tx) => {
      await assertDeviceQuota(tx, tenantId);
      const [d] = await tx
        .insert(devices)
        .values({
          tenantId,
          name: body.name,
          imei: body.imei,
          type: body.type,
          protocol: body.protocol,
          registrationNumber: body.registrationNumber ?? null,
          status: body.status,
        })
        .returning();
      return d!;
    });
    return c.json(toSummary(device), 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw errors.duplicate('A device with this IMEI already exists');
    }
    throw err;
  }
});

deviceRoutes.put('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = updateDeviceSchema.parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v;
  const device = await withTenant(db, tenantId, async (tx) => {
    const [d] = await tx.update(devices).set(patch).where(eq(devices.id, c.req.param('id'))).returning();
    return d;
  });
  if (!device) throw errors.notFound('Device not found');
  return c.json(toSummary(device));
});

deviceRoutes.delete('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const deleted = await withTenant(db, tenantId, async (tx) => {
    const [d] = await tx
      .delete(devices)
      .where(and(eq(devices.id, c.req.param('id')), eq(devices.tenantId, tenantId)))
      .returning({ id: devices.id });
    return d;
  });
  if (!deleted) throw errors.notFound('Device not found');
  return c.body(null, 204);
});

deviceRoutes.get('/:id', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const device = await withTenant(db, tenantId, async (tx) => {
    const [d] = await tx.select().from(devices).where(eq(devices.id, c.req.param('id')));
    return d;
  });
  if (!device) throw errors.notFound('Device not found');
  return c.json(toSummary(device));
});

deviceRoutes.post('/:id/report', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const body = reportPositionSchema.parse(await c.req.json());
  const fired = await withTenant(db, tenantId, async (tx) => {
    const [device] = await tx
      .select({ id: devices.id, imei: devices.imei })
      .from(devices)
      .where(eq(devices.id, id));
    if (!device) return null;
    return recordPosition(tx, {
      deviceId: device.id,
      tenantId,
      imei: device.imei,
      latitude: body.latitude,
      longitude: body.longitude,
      speedKph: body.speedKph ?? 0,
      course: body.course ?? 0,
      gpsValid: body.gpsValid ?? true,
      fixTime: body.timestamp ? new Date(body.timestamp) : new Date(),
      kind: 'location',
    });
  });
  if (fired === null) throw errors.notFound('Device not found');
  if (fired.length > 0) void dispatchAlerts(tenantId, fired);
  return c.json({ ok: true }, 201);
});

deviceRoutes.get('/:id/trips', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const rows = await withTenant(db, tenantId, async (tx) => {
    const [d] = await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, id));
    if (!d) return null;
    return tx.select().from(trips).where(eq(trips.deviceId, id)).orderBy(desc(trips.startedAt)).limit(100);
  });
  if (rows === null) throw errors.notFound('Device not found');
  return c.json({
    deviceId: id,
    trips: rows.map((t) => ({
      id: t.id,
      startedAt: t.startedAt.toISOString(),
      endedAt: t.endedAt.toISOString(),
      durationS: t.durationS,
      distanceKm: t.distanceKm,
      avgSpeedKph: t.avgSpeedKph,
      maxSpeedKph: t.maxSpeedKph,
      speedingSamples: t.speedingSamples,
    })),
    total: rows.length,
  });
});

deviceRoutes.get('/:id/history', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const now = Date.now();
  const from = new Date(Number(c.req.query('from') ?? now - 24 * 3600 * 1000));
  const to = new Date(Number(c.req.query('to') ?? now));
  const limit = Math.min(Number(c.req.query('limit') ?? 1000), 5000);

  const rows = await withTenant(db, tenantId, async (tx) => {
    const [device] = await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, id));
    if (!device) return null;
    return tx
      .select({
        lat: positions.lat,
        lon: positions.lon,
        speedKph: positions.speedKph,
        course: positions.course,
        fixTime: positions.fixTime,
      })
      .from(positions)
      .where(and(eq(positions.deviceId, id), gte(positions.fixTime, from), lte(positions.fixTime, to)))
      .orderBy(desc(positions.fixTime))
      .limit(limit);
  });

  if (rows === null) throw errors.notFound('Device not found');
  return c.json({
    deviceId: id,
    points: rows.map((r) => ({
      latitude: r.lat,
      longitude: r.lon,
      speedKph: r.speedKph,
      course: r.course,
      fixTime: r.fixTime.toISOString(),
    })),
    total: rows.length,
  });
});

// ---------- two-way device commands ----------

function toCommand(c: DeviceCommand) {
  return {
    id: c.id,
    deviceId: c.deviceId,
    command: c.command,
    parameters: c.parameters,
    status: c.status,
    response: c.response,
    requestedBy: c.requestedBy,
    sentAt: c.sentAt ? c.sentAt.toISOString() : null,
    ackedAt: c.ackedAt ? c.ackedAt.toISOString() : null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

// Queue a command for a device. The TCP ingest service (or the device's HTTP
// poll endpoint, /internal/devices/:id/commands/pending) drains queued rows.
deviceRoutes.post('/:id/commands', requirePermission('devices:write'), async (c) => {
  const { tenantId, userId } = c.get('principal');
  const deviceId = c.req.param('id');
  const body = queueDeviceCommandSchema.parse(await c.req.json());
  const expiresAt = body.expiresInSeconds ? new Date(Date.now() + body.expiresInSeconds * 1000) : null;
  const result = await withTenant(db, tenantId, async (tx) => {
    const [d] = await tx.select({ id: devices.id, imei: devices.imei }).from(devices).where(eq(devices.id, deviceId));
    if (!d) return null;
    const [cmd] = await tx
      .insert(deviceCommands)
      .values({ tenantId, deviceId, command: body.command, parameters: body.parameters ?? {}, requestedBy: userId ?? null, expiresAt })
      .returning();
    return { cmd: cmd!, imei: d.imei };
  });
  if (!result) throw errors.notFound('Device not found');
  // Advisory: if a shared presence registry is configured, tell the caller
  // whether the device is connected now (prompt delivery) or the command will
  // wait for its next reconnect. Null = presence not authoritative (single
  // instance) — the command still queues and drains on connect either way.
  const presence = await lookupPresence(result.imei);
  return c.json(
    { ...toCommand(result.cmd), delivery: { connected: !!presence, instanceId: presence?.instanceId ?? null } },
    201,
  );
});

deviceRoutes.get('/:id/commands', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const deviceId = c.req.param('id');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const rows = await withTenant(db, tenantId, async (tx) => {
    const filters = [eq(deviceCommands.deviceId, deviceId), status ? eq(deviceCommands.status, status) : undefined].filter(Boolean);
    return tx
      .select()
      .from(deviceCommands)
      .where(and(...filters))
      .orderBy(desc(deviceCommands.createdAt))
      .limit(limit);
  });
  return c.json({ commands: rows.map(toCommand), total: rows.length });
});

// Cancel a queued command (no-op if already sent/acked).
deviceRoutes.delete('/:id/commands/:cmdId', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const cmdId = c.req.param('cmdId');
  const row = await withTenant(db, tenantId, async (tx) => {
    const [updated] = await tx
      .update(deviceCommands)
      .set({ status: 'canceled' })
      .where(and(eq(deviceCommands.id, cmdId), eq(deviceCommands.status, 'queued')))
      .returning();
    return updated;
  });
  if (!row) throw errors.notFound('Queued command not found');
  return c.json(toCommand(row));
});
