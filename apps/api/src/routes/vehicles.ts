import { type Device, type Vehicle, and, asc, devices, eq, vehicles, withTenant } from '@trackflow/db';
import type { DeviceAttributes } from '@trackflow/db';
import { createVehicleSchema, errors, type VehicleSummary, updateVehicleSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const vehicleRoutes = new Hono<AppEnv>();

function aggregate(devs: Device[]): Pick<VehicleSummary, 'lastPosition' | 'attributes' | 'lastSeen'> {
  const withPos = devs
    .filter((d) => d.lastLat != null && d.lastLon != null)
    .sort((a, b) => (b.lastFixTime?.getTime() ?? 0) - (a.lastFixTime?.getTime() ?? 0));
  const best = withPos[0];
  const lastPosition = best
    ? {
        latitude: best.lastLat!,
        longitude: best.lastLon!,
        speedKph: best.lastSpeed ?? 0,
        course: best.lastCourse ?? 0,
        fixTime: (best.lastFixTime ?? new Date()).toISOString(),
      }
    : null;

  // Merge telemetry across devices; the most recently seen device wins on conflicts.
  const sorted = [...devs].sort((a, b) => (a.lastSeen?.getTime() ?? 0) - (b.lastSeen?.getTime() ?? 0));
  let attributes: DeviceAttributes | null = null;
  for (const d of sorted) if (d.lastAttributes) attributes = { ...(attributes ?? {}), ...d.lastAttributes };

  const lastSeenMs = devs.reduce((max, d) => Math.max(max, d.lastSeen?.getTime() ?? 0), 0);
  return { lastPosition, attributes, lastSeen: lastSeenMs ? new Date(lastSeenMs).toISOString() : null };
}

function toSummary(v: Vehicle, devs: Device[]): VehicleSummary {
  return {
    id: v.id,
    name: v.name,
    registration: v.registration,
    make: v.make,
    model: v.model,
    deviceCount: devs.length,
    devices: devs.map((d) => ({
      id: d.id,
      name: d.name,
      protocol: d.protocol,
      status: d.status as VehicleSummary['devices'][number]['status'],
      lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
      hasPosition: d.lastLat != null && d.lastLon != null,
    })),
    ...aggregate(devs),
  };
}

vehicleRoutes.get('/', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const { vs, ds } = await withTenant(db, tenantId, async (tx) => ({
    vs: await tx.select().from(vehicles).orderBy(asc(vehicles.name)),
    ds: await tx.select().from(devices),
  }));
  const byVehicle = new Map<string, Device[]>();
  for (const d of ds) if (d.vehicleId) byVehicle.set(d.vehicleId, [...(byVehicle.get(d.vehicleId) ?? []), d]);
  return c.json({ vehicles: vs.map((v) => toSummary(v, byVehicle.get(v.id) ?? [])), total: vs.length });
});

vehicleRoutes.post('/', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = createVehicleSchema.parse(await c.req.json());
  const v = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.insert(vehicles).values({ tenantId, ...body }).returning();
    return row!;
  });
  return c.json(toSummary(v, []), 201);
});

vehicleRoutes.get('/:id', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const result = await withTenant(db, tenantId, async (tx) => {
    const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, id));
    if (!v) return null;
    const devs = await tx.select().from(devices).where(eq(devices.vehicleId, id));
    return { v, devs };
  });
  if (!result) throw errors.notFound('Vehicle not found');
  return c.json(toSummary(result.v, result.devs));
});

vehicleRoutes.put('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = updateVehicleSchema.parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v;
  const result = await withTenant(db, tenantId, async (tx) => {
    const [v] = await tx.update(vehicles).set(patch).where(eq(vehicles.id, c.req.param('id'))).returning();
    if (!v) return null;
    const devs = await tx.select().from(devices).where(eq(devices.vehicleId, v.id));
    return { v, devs };
  });
  if (!result) throw errors.notFound('Vehicle not found');
  return c.json(toSummary(result.v, result.devs));
});

vehicleRoutes.delete('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const deleted = await withTenant(db, tenantId, async (tx) => {
    const [v] = await tx
      .delete(vehicles)
      .where(and(eq(vehicles.id, c.req.param('id')), eq(vehicles.tenantId, tenantId)))
      .returning({ id: vehicles.id });
    return v;
  });
  if (!deleted) throw errors.notFound('Vehicle not found');
  return c.body(null, 204);
});
