import { and, desc, eq, orgMemberships, sql, tenants, users } from '@trackflow/db';
import { errors, hashPassword, inviteUserSchema, mfaRequirementSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { assertUserQuota } from '../billing-service.js';
import { db } from '../db.js';
import { sendEmail } from '../email.js';
import { env } from '../env.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const userRoutes = new Hono<AppEnv>();

userRoutes.use('*', requirePermission('users:manage'));

userRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(desc(users.createdAt));
  return c.json({ users: rows, total: rows.length });
});

userRoutes.post('/', async (c) => {
  const { tenantId } = c.get('principal');
  const body = inviteUserSchema.parse(await c.req.json());
  await assertUserQuota(tenantId);
  // Mint a temporary password; email it to the invitee and also return it once
  // so the inviter can share it if email delivery isn't configured (dev).
  const tempPassword = crypto.randomUUID().replace(/-/g, '').slice(0, 14);
  try {
    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(tempPassword),
      })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    // Mirror as a membership row so the multi-org listing sees the invited user.
    await db
      .insert(orgMemberships)
      .values({ userId: user!.id, tenantId, role: body.role })
      .onConflictDoNothing();
    void sendEmail(
      body.email,
      "You've been invited to TrackFlow",
      `You've been added to a TrackFlow workspace as ${body.role}.\n\nSign in at ${env.webOrigin}/login\n  Email: ${body.email}\n  Temporary password: ${tempPassword}\n\nPlease change your password after your first sign-in.`,
    ).catch(() => {});
    await recordAudit({
      tenantId,
      actorUserId: actorUserId(c),
      actorIp: actorIp(c),
      action: 'user.invited',
      target: 'user',
      targetId: user!.id,
      metadata: { email: body.email, role: body.role },
    });
    return c.json({ user: user!, tempPassword }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw errors.duplicate('Email already in use');
    throw err;
  }
});

// Workspace MFA policy: when required, members without MFA are prompted to
// enroll at login (the dashboard routes them to setup).
userRoutes.put('/mfa-requirement', async (c) => {
  const { tenantId } = c.get('principal');
  const { required } = mfaRequirementSchema.parse(await c.req.json());
  await db.update(tenants).set({ requireMfa: required }).where(eq(tenants.id, tenantId));
  await recordAudit({
    tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'tenant.mfa_requirement_changed',
    target: 'tenant',
    targetId: tenantId,
    metadata: { required },
  });
  return c.json({ required });
});

// Remove a member. Guards against deleting the workspace's last owner (lockout).
userRoutes.delete('/:id', async (c) => {
  const { tenantId } = c.get('principal');
  const targetId = c.req.param('id');
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.tenantId, tenantId)));
  if (!target) throw errors.notFound('User not found');

  if (target.role === 'owner') {
    const [owners] = await db
      .select({ n: sql<string>`count(*)` })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'owner')));
    if (Number(owners!.n) <= 1) throw errors.validation('Cannot remove the last owner of a workspace');
  }

  await db.delete(users).where(and(eq(users.id, targetId), eq(users.tenantId, tenantId)));
  await recordAudit({
    tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'user.removed',
    target: 'user',
    targetId,
    metadata: { role: target.role },
  });
  return c.body(null, 204);
});
