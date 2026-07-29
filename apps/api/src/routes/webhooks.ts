import { and, desc, eq, type Webhook, type WebhookDelivery, webhookDeliveries, webhooks, withTenant } from '@trackflow/db';
import { createWebhookSchema, errors, updateWebhookSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { deliverOne } from '../webhook-service.js';
import { validateWebhookTarget } from '../webhook-target.js';

export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.use('*', requirePermission('webhooks:manage'));

function toSummary(w: Webhook, includeSecret = false) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    events: w.events,
    deviceIds: w.deviceIds,
    ...(includeSecret ? { secret: w.secret } : {}),
    status: w.status,
    successCount: w.successCount,
    failureCount: w.failureCount,
    lastSuccessAt: w.lastSuccessAt ? w.lastSuccessAt.toISOString() : null,
    lastFailureAt: w.lastFailureAt ? w.lastFailureAt.toISOString() : null,
    lastError: w.lastError,
    createdAt: w.createdAt.toISOString(),
  };
}

function toDelivery(d: WebhookDelivery) {
  return {
    id: d.id,
    webhookId: d.webhookId,
    event: d.event,
    attempt: d.attempt,
    status: d.status,
    httpStatus: d.httpStatus,
    error: d.error,
    durationMs: d.durationMs,
    createdAt: d.createdAt.toISOString(),
  };
}

function webhookSecret(): string {
  return `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')}`;
}

webhookRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(webhooks).orderBy(desc(webhooks.createdAt)),
  );
  return c.json({ webhooks: rows.map((row) => toSummary(row)), total: rows.length });
});

webhookRoutes.post('/', async (c) => {
  const { tenantId } = c.get('principal');
  const body = createWebhookSchema.parse(await c.req.json());
  try {
    await validateWebhookTarget(body.url);
  } catch (error) {
    throw errors.validation((error as Error).message);
  }
  const row = await withTenant(db, tenantId, async (tx) => {
    const [w] = await tx
      .insert(webhooks)
      .values({
        tenantId,
        name: body.name,
        url: body.url,
        events: body.events,
        deviceIds: body.deviceIds ?? [],
        secret: webhookSecret(),
      })
      .returning();
    return w!;
  });
  await recordAudit({ tenantId, actorUserId: actorUserId(c), actorIp: actorIp(c), action: 'webhook.created', target: 'webhook', targetId: row.id, metadata: { url: row.url, events: row.events } });
  // Reveal the signing secret exactly once, matching the API-key lifecycle.
  return c.json(toSummary(row, true), 201);
});

// Edit any subset of url/events/deviceIds/name/status (e.g., pause a noisy hook,
// extend its event subscriptions, or scope it to a different device set).
webhookRoutes.patch('/:id', async (c) => {
  const { tenantId } = c.get('principal');
  const body = updateWebhookSchema.parse(await c.req.json());
  if (Object.keys(body).length === 0) throw errors.validation('No fields to update');
  if (body.url) {
    try {
      await validateWebhookTarget(body.url);
    } catch (error) {
      throw errors.validation((error as Error).message);
    }
  }
  const row = await withTenant(db, tenantId, async (tx) => {
    const [w] = await tx
      .update(webhooks)
      .set(body)
      .where(and(eq(webhooks.id, c.req.param('id')), eq(webhooks.tenantId, tenantId)))
      .returning();
    return w;
  });
  if (!row) throw errors.notFound('Webhook not found');
  await recordAudit({ tenantId, actorUserId: actorUserId(c), actorIp: actorIp(c), action: 'webhook.updated', target: 'webhook', targetId: row.id, metadata: body });
  return c.json(toSummary(row));
});

// Per-attempt delivery log for a webhook (newest first; ?status= to filter).
webhookRoutes.get('/:id/deliveries', async (c) => {
  const { tenantId } = c.get('principal');
  const id = c.req.param('id');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const status = c.req.query('status');
  const rows = await withTenant(db, tenantId, async (tx) => {
    // Verify the webhook belongs to the tenant (404 vs leaking deliveries for nonexistent ids).
    const [w] = await tx.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, id));
    if (!w) return null;
    const filters = [eq(webhookDeliveries.webhookId, id), status ? eq(webhookDeliveries.status, status) : undefined].filter(Boolean);
    return tx
      .select()
      .from(webhookDeliveries)
      .where(and(...filters))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
  });
  if (rows === null) throw errors.notFound('Webhook not found');
  return c.json({ deliveries: rows.map(toDelivery), total: rows.length });
});

webhookRoutes.delete('/:id', async (c) => {
  const { tenantId } = c.get('principal');
  const deleted = await withTenant(db, tenantId, async (tx) => {
    const [w] = await tx
      .delete(webhooks)
      .where(and(eq(webhooks.id, c.req.param('id')), eq(webhooks.tenantId, tenantId)))
      .returning({ id: webhooks.id });
    return w;
  });
  if (!deleted) throw errors.notFound('Webhook not found');
  await recordAudit({ tenantId, actorUserId: actorUserId(c), actorIp: actorIp(c), action: 'webhook.deleted', target: 'webhook', targetId: deleted.id });
  return c.body(null, 204);
});

webhookRoutes.post('/:id/test', async (c) => {
  const { tenantId } = c.get('principal');
  const hook = await withTenant(db, tenantId, async (tx) => {
    const [w] = await tx.select().from(webhooks).where(eq(webhooks.id, c.req.param('id')));
    return w;
  });
  if (!hook) throw errors.notFound('Webhook not found');
  const outcome = await deliverOne(hook, 'webhook.test', { message: 'Test event from TrackFlow' });
  return c.json(outcome);
});
