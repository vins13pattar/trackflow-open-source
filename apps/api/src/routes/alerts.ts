import { type Alert, type AlertDeliveryRow, alertDeliveries, alerts, and, desc, eq, sql, withTenant } from '@trackflow/db';
import { errors } from '@trackflow/shared';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const alertRoutes = new Hono<AppEnv>();

alertRoutes.use('*', requirePermission('alerts:read'));

function toSummary(a: Alert) {
  return {
    id: a.id,
    deviceId: a.deviceId,
    geofenceId: a.geofenceId,
    type: a.type,
    severity: a.severity,
    title: a.title,
    message: a.message,
    lat: a.lat,
    lon: a.lon,
    acknowledged: a.acknowledged,
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
    notifications: a.notifications,
    createdAt: a.createdAt.toISOString(),
  };
}

alertRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const onlyUnack = c.req.query('acknowledged') === 'false';
  const rows = await withTenant(db, tenantId, (tx) => {
    const base = tx.select().from(alerts);
    return onlyUnack
      ? base.where(eq(alerts.acknowledged, false)).orderBy(desc(alerts.createdAt)).limit(limit)
      : base.orderBy(desc(alerts.createdAt)).limit(limit);
  });
  return c.json({ alerts: rows.map(toSummary), total: rows.length });
});

function toDelivery(d: AlertDeliveryRow) {
  return {
    id: d.id,
    alertId: d.alertId,
    channel: d.channel,
    recipient: d.recipient,
    status: d.status,
    attempt: d.attempt,
    error: d.error,
    nextRetryAt: d.nextRetryAt ? d.nextRetryAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Delivery log: per-attempt notification outcomes, newest first. Optional
// `alertId` and `status` filters. RLS scopes rows to the caller's tenant.
alertRoutes.get('/deliveries', async (c) => {
  const { tenantId } = c.get('principal');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const alertId = c.req.query('alertId');
  const status = c.req.query('status');
  const rows = await withTenant(db, tenantId, (tx) => {
    const filters = [
      alertId ? eq(alertDeliveries.alertId, alertId) : undefined,
      status ? eq(alertDeliveries.status, status) : undefined,
    ].filter(Boolean);
    return tx
      .select()
      .from(alertDeliveries)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(alertDeliveries.createdAt))
      .limit(limit);
  });
  return c.json({ deliveries: rows.map(toDelivery), total: rows.length });
});

alertRoutes.post('/:id/ack', async (c) => {
  const { tenantId } = c.get('principal');
  const updated = await withTenant(db, tenantId, async (tx) => {
    const [a] = await tx
      .update(alerts)
      .set({ acknowledged: true, acknowledgedAt: sql`now()` })
      .where(and(eq(alerts.id, c.req.param('id')), eq(alerts.tenantId, tenantId)))
      .returning();
    return a;
  });
  if (!updated) throw errors.notFound('Alert not found');
  return c.json(toSummary(updated));
});
