import { and, asc, eq, geofences, withTenant } from '@trackflow/db';
import type { Geofence } from '@trackflow/db';
import { createGeofenceSchema, errors, updateGeofenceSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const geofenceRoutes = new Hono<AppEnv>();

function toSummary(g: Geofence) {
  return {
    id: g.id,
    name: g.name,
    type: g.type,
    center: g.centerLat != null && g.centerLon != null ? { lat: g.centerLat, lng: g.centerLon } : null,
    radiusM: g.radiusM,
    points: g.points ?? null,
    color: g.color,
    onEntry: g.onEntry,
    onExit: g.onExit,
    onDwell: g.onDwell,
    dwellSeconds: g.dwellSeconds,
    throttleSeconds: g.throttleSeconds,
    channels: g.channels,
    recipients: g.recipients,
    allDevices: g.allDevices,
    deviceIds: g.deviceIds,
    status: g.status,
    createdAt: g.createdAt.toISOString(),
  };
}

geofenceRoutes.get('/', requirePermission('geofences:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(geofences).orderBy(asc(geofences.name)),
  );
  return c.json({ geofences: rows.map(toSummary), total: rows.length });
});

geofenceRoutes.post('/', requirePermission('geofences:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = createGeofenceSchema.parse(await c.req.json());
  const geofence = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx
      .insert(geofences)
      .values({
        tenantId,
        name: body.name,
        type: body.type,
        centerLat: body.center?.lat ?? null,
        centerLon: body.center?.lng ?? null,
        radiusM: body.radiusM ?? null,
        points: body.points ?? null,
        color: body.color ?? '#6366f1',
        onEntry: body.onEntry,
        onExit: body.onExit,
        onDwell: body.onDwell,
        dwellSeconds: body.dwellSeconds,
        throttleSeconds: body.throttleSeconds,
        channels: body.channels,
        recipients: body.recipients,
        allDevices: body.allDevices,
        deviceIds: body.deviceIds,
      })
      .returning();
    return g!;
  });
  return c.json(toSummary(geofence), 201);
});

geofenceRoutes.get('/:id', requirePermission('geofences:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const geofence = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx.select().from(geofences).where(eq(geofences.id, c.req.param('id')));
    return g;
  });
  if (!geofence) throw errors.notFound('Geofence not found');
  return c.json(toSummary(geofence));
});

geofenceRoutes.patch('/:id', requirePermission('geofences:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = updateGeofenceSchema.parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v;

  const geofence = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx.update(geofences).set(patch).where(eq(geofences.id, c.req.param('id'))).returning();
    return g;
  });
  if (!geofence) throw errors.notFound('Geofence not found');
  return c.json(toSummary(geofence));
});

geofenceRoutes.delete('/:id', requirePermission('geofences:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const deleted = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx
      .delete(geofences)
      .where(and(eq(geofences.id, c.req.param('id')), eq(geofences.tenantId, tenantId)))
      .returning({ id: geofences.id });
    return g;
  });
  if (!deleted) throw errors.notFound('Geofence not found');
  return c.body(null, 204);
});
