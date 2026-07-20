import {
  alerts,
  apiKeys,
  auditLogs,
  desc,
  deviceGroupMembers,
  deviceGroups,
  devices,
  eq,
  geofences,
  invoices,
  positions,
  sql,
  tenants,
  trips,
  users,
  vehicles,
  webhooks,
  withTenant,
} from '@trackflow/db';
import { deleteTenantSchema, errors, verifyPassword } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';

/**
 * Data-subject rights (DPDP Act 2023 / GDPR): a workspace owner can export
 * everything we hold about the tenant and hard-delete the whole workspace.
 */
export const privacyRoutes = new Hono<AppEnv>();

/** Newest positions included inline in the export; older history is available
 *  via the paginated history API before deletion if a full dump is needed. */
const EXPORT_POSITIONS_CAP = 50_000;

function requireOwner(principal: AppEnv['Variables']['principal']) {
  if (!principal.userId || principal.role !== 'owner') {
    throw errors.forbidden('Only a workspace owner can do this');
  }
}

privacyRoutes.get('/export', async (c) => {
  const principal = c.get('principal');
  requireOwner(principal);
  const tenantId = principal.tenantId;

  const [tenant] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: tenants.plan,
      subscriptionStatus: tenants.subscriptionStatus,
      locale: tenants.locale,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  const members = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      mfaEnabled: sql<boolean>`${users.mfaEnabledAt} is not null`,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.tenantId, tenantId));

  const data = await withTenant(db, tenantId, async (tx) => {
    const [{ n: positionsTotal }] = (await tx
      .select({ n: sql<string>`count(*)` })
      .from(positions)
      .where(eq(positions.tenantId, tenantId))) as [{ n: string }];
    return {
      devices: await tx.select().from(devices).where(eq(devices.tenantId, tenantId)),
      vehicles: await tx.select().from(vehicles).where(eq(vehicles.tenantId, tenantId)),
      deviceGroups: await tx.select().from(deviceGroups).where(eq(deviceGroups.tenantId, tenantId)),
      deviceGroupMembers: await tx
        .select({ groupId: deviceGroupMembers.groupId, deviceId: deviceGroupMembers.deviceId })
        .from(deviceGroupMembers),
      geofences: await tx.select().from(geofences).where(eq(geofences.tenantId, tenantId)),
      alerts: await tx.select().from(alerts).where(eq(alerts.tenantId, tenantId)),
      trips: await tx.select().from(trips).where(eq(trips.tenantId, tenantId)),
      invoices: await tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)),
      auditLogs: await tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)),
      // Secrets/hashes never leave the system: explicit safe columns only.
      apiKeys: await tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          lastUsedAt: apiKeys.lastUsedAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.tenantId, tenantId)),
      webhooks: await tx
        .select({
          id: webhooks.id,
          name: webhooks.name,
          url: webhooks.url,
          events: webhooks.events,
          deviceIds: webhooks.deviceIds,
          status: webhooks.status,
        })
        .from(webhooks)
        .where(eq(webhooks.tenantId, tenantId)),
      positionsTotal: Number(positionsTotal),
      positions: await tx
        .select()
        .from(positions)
        .where(eq(positions.tenantId, tenantId))
        .orderBy(desc(positions.fixTime))
        .limit(EXPORT_POSITIONS_CAP),
    };
  });

  c.header('content-disposition', `attachment; filename="trackflow-export-${tenant?.slug ?? tenantId}.json"`);
  return c.json({
    exportedAt: new Date().toISOString(),
    format: 'trackflow-export/v1',
    tenant,
    users: members,
    ...data,
    positionsTruncated: data.positionsTotal > data.positions.length,
  });
});

// Irreversible hard delete of the whole workspace. Requires the owner's
// password AND a typed confirmation phrase. Positions are purged explicitly
// (RLS-scoped); everything else cascades from the tenants row.
privacyRoutes.delete('/tenant', async (c) => {
  const principal = c.get('principal');
  requireOwner(principal);
  const { password, confirm } = deleteTenantSchema.parse(await c.req.json());
  if (confirm !== 'delete my workspace') {
    throw errors.validation('Type "delete my workspace" to confirm');
  }

  const [user] = await db.select().from(users).where(eq(users.id, principal.userId!));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw errors.unauthorized('Password is incorrect');
  }

  const tenantId = principal.tenantId;
  await withTenant(db, tenantId, (tx) => tx.delete(positions).where(eq(positions.tenantId, tenantId)));
  await db.delete(tenants).where(eq(tenants.id, tenantId));

  // The audit trail dies with the tenant, so the deletion itself goes to the
  // structured log (and from there to whatever log sink production ships to).
  console.log(
    JSON.stringify({
      level: 'warn',
      event: 'tenant.hard_deleted',
      tenantId,
      actorUserId: principal.userId,
      at: new Date().toISOString(),
    }),
  );
  return c.body(null, 204);
});
