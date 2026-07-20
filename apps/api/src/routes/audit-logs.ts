import { auditLogs, type AuditLog, desc, withTenant } from '@trackflow/db';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const auditLogRoutes = new Hono<AppEnv>();

auditLogRoutes.use('*', requirePermission('users:manage'));

function toSummary(a: AuditLog) {
  return {
    id: a.id,
    actorUserId: a.actorUserId,
    actorIp: a.actorIp,
    action: a.action,
    target: a.target,
    targetId: a.targetId,
    metadata: a.metadata,
    createdAt: a.createdAt.toISOString(),
  };
}

auditLogRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit),
  );
  return c.json({ logs: rows.map(toSummary), total: rows.length });
});
