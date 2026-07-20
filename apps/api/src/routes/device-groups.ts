import { type DeviceGroup, and, deviceGroupMembers, deviceGroups, desc, devices, eq, inArray, withTenant } from '@trackflow/db';
import { createDeviceGroupSchema, errors, setGroupMembersSchema, updateDeviceGroupSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const deviceGroupRoutes = new Hono<AppEnv>();

function toSummary(g: DeviceGroup & { deviceIds?: string[] }) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    color: g.color,
    deviceIds: g.deviceIds ?? [],
    createdAt: g.createdAt.toISOString(),
  };
}

deviceGroupRoutes.get('/', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, async (tx) => {
    const groupRows = await tx.select().from(deviceGroups).orderBy(desc(deviceGroups.createdAt));
    if (groupRows.length === 0) return [];
    const members = await tx
      .select()
      .from(deviceGroupMembers)
      .where(
        inArray(
          deviceGroupMembers.groupId,
          groupRows.map((g) => g.id),
        ),
      );
    const byGroup = new Map<string, string[]>();
    for (const m of members) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m.deviceId]);
    return groupRows.map((g) => ({ ...g, deviceIds: byGroup.get(g.id) ?? [] }));
  });
  return c.json({ groups: rows.map(toSummary), total: rows.length });
});

deviceGroupRoutes.post('/', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = createDeviceGroupSchema.parse(await c.req.json());
  const result = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx
      .insert(deviceGroups)
      .values({ tenantId, name: body.name, description: body.description ?? null, color: body.color ?? '#6366f1' })
      .returning();
    if (body.deviceIds && body.deviceIds.length > 0) {
      // RLS scopes the select; an unknown device id just won't appear.
      const owned = await tx.select({ id: devices.id }).from(devices).where(inArray(devices.id, body.deviceIds));
      if (owned.length > 0) {
        await tx.insert(deviceGroupMembers).values(owned.map((d) => ({ tenantId, groupId: g!.id, deviceId: d.id })));
      }
      return { ...g!, deviceIds: owned.map((d) => d.id) };
    }
    return { ...g!, deviceIds: [] };
  });
  return c.json(toSummary(result), 201);
});

deviceGroupRoutes.get('/:id', requirePermission('devices:read'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const row = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx.select().from(deviceGroups).where(eq(deviceGroups.id, id));
    if (!g) return null;
    const members = await tx.select({ deviceId: deviceGroupMembers.deviceId }).from(deviceGroupMembers).where(eq(deviceGroupMembers.groupId, id));
    return { ...g, deviceIds: members.map((m) => m.deviceId) };
  });
  if (!row) throw errors.notFound('Device group not found');
  return c.json(toSummary(row));
});

deviceGroupRoutes.patch('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const body = updateDeviceGroupSchema.parse(await c.req.json());
  if (Object.keys(body).length === 0) throw errors.validation('No fields to update');
  const row = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx
      .update(deviceGroups)
      .set(body)
      .where(and(eq(deviceGroups.id, id), eq(deviceGroups.tenantId, tenantId)))
      .returning();
    return g;
  });
  if (!row) throw errors.notFound('Device group not found');
  return c.json(toSummary(row));
});

deviceGroupRoutes.delete('/:id', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const deleted = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx
      .delete(deviceGroups)
      .where(and(eq(deviceGroups.id, id), eq(deviceGroups.tenantId, tenantId)))
      .returning({ id: deviceGroups.id });
    return g;
  });
  if (!deleted) throw errors.notFound('Device group not found');
  return c.body(null, 204);
});

// Replace the group's membership with `deviceIds` (set semantics — sends the
// full desired list, the server diffs).
deviceGroupRoutes.put('/:id/devices', requirePermission('devices:write'), async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const { deviceIds } = setGroupMembersSchema.parse(await c.req.json());
  const row = await withTenant(db, tenantId, async (tx) => {
    const [g] = await tx.select().from(deviceGroups).where(eq(deviceGroups.id, id));
    if (!g) return null;
    await tx.delete(deviceGroupMembers).where(eq(deviceGroupMembers.groupId, id));
    if (deviceIds.length > 0) {
      const owned = await tx.select({ id: devices.id }).from(devices).where(inArray(devices.id, deviceIds));
      if (owned.length > 0) {
        await tx.insert(deviceGroupMembers).values(owned.map((d) => ({ tenantId, groupId: id, deviceId: d.id })));
      }
      return { ...g, deviceIds: owned.map((d) => d.id) };
    }
    return { ...g, deviceIds: [] };
  });
  if (!row) throw errors.notFound('Device group not found');
  return c.json(toSummary(row));
});
