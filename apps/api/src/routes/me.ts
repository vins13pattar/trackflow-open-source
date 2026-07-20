import { and, desc, eq, isNull, orgMemberships, sessions, tenants, users } from '@trackflow/db';
import {
  changePasswordSchema,
  errors,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashRecoveryCode,
  issueTokens,
  mfaCodeSchema,
  otpauthUri,
  switchOrgSchema,
  verifyPassword,
  verifyTotp,
} from '@trackflow/shared';
import { Hono } from 'hono';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { db } from '../db.js';
import { env } from '../env.js';
import type { AppEnv } from '../middleware/auth.js';

export const meRoutes = new Hono<AppEnv>();

// All the tenants the current user has a membership in. Useful for the
// org-switcher dropdown in the dashboard.
meRoutes.get('/memberships', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys cannot list memberships');
  const rows = await db
    .select({
      tenantId: orgMemberships.tenantId,
      role: orgMemberships.role,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(orgMemberships)
    .innerJoin(tenants, eq(tenants.id, orgMemberships.tenantId))
    .where(eq(orgMemberships.userId, principal.userId));
  return c.json({ memberships: rows, total: rows.length, activeTenantId: principal.tenantId });
});

// Switch to a different tenant the user is a member of. Returns fresh tokens
// scoped to the chosen tenant; the old refresh-token session remains valid for
// the previous tenant so multi-tab use keeps working.
meRoutes.post('/switch-org', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys cannot switch organisations');
  const { tenantId } = switchOrgSchema.parse(await c.req.json());

  const [membership] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, principal.userId), eq(orgMemberships.tenantId, tenantId)));
  if (!membership) throw errors.forbidden('Not a member of that organisation');

  const { jti, ...tokens } = await issueTokens({ sub: principal.userId, tid: tenantId, role: membership.role }, env.jwt);
  // Record the new session so refresh-rotation + logout work for it.
  await db.insert(sessions).values({
    id: jti,
    userId: principal.userId,
    tenantId,
    expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
  });
  return c.json({ tenantId, role: membership.role, tokens });
});

// Authenticated password change. Verifies the current password, hashes the new
// one, and revokes every other refresh session so re-login is required on other
// devices (mirroring the password-reset behaviour). The presented access token
// keeps working until it naturally expires.
meRoutes.post('/password', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys cannot change a password');
  const { currentPassword, newPassword } = changePasswordSchema.parse(await c.req.json());
  const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw errors.unauthorized('Current password is incorrect');
  }
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, principal.userId));
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, principal.userId), isNull(sessions.revokedAt)));
  await recordAudit({
    tenantId: principal.tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'user.password_changed',
    target: 'user',
    targetId: principal.userId,
  });
  return c.json({ ok: true });
});

// Active refresh sessions across all devices. Useful for an "active devices"
// list in the settings UI plus a one-click "sign out everywhere" affordance.
meRoutes.get('/sessions', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not own sessions');
  const rows = await db
    .select({
      id: sessions.id,
      tenantId: sessions.tenantId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, principal.userId))
    .orderBy(desc(sessions.createdAt));
  return c.json({ sessions: rows, total: rows.length });
});

// ---------- MFA (TOTP) ----------

async function currentUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw errors.unauthorized('User not found');
  return user;
}

meRoutes.get('/mfa', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not have MFA');
  const user = await currentUser(principal.userId);
  const [tenant] = await db
    .select({ requireMfa: tenants.requireMfa })
    .from(tenants)
    .where(eq(tenants.id, principal.tenantId));
  return c.json({
    enabled: !!user.mfaEnabledAt,
    pendingSetup: !!user.mfaSecret && !user.mfaEnabledAt,
    recoveryCodesRemaining: user.mfaEnabledAt ? (user.mfaRecoveryCodes?.length ?? 0) : 0,
    requiredByTenant: !!tenant?.requireMfa,
  });
});

// Starts (or restarts) enrollment: a fresh secret is stored as pending and
// returned once, with the otpauth:// URI an authenticator app consumes.
meRoutes.post('/mfa/setup', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not have MFA');
  const user = await currentUser(principal.userId);
  if (user.mfaEnabledAt) throw errors.validation('MFA is already enabled — disable it first');

  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecret: secret }).where(eq(users.id, user.id));
  return c.json({
    secret,
    otpauthUri: otpauthUri({ secret, accountName: user.email, issuer: 'TrackFlow' }),
  });
});

// Confirms enrollment with the first code; returns the recovery codes ONCE.
meRoutes.post('/mfa/enable', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not have MFA');
  const { code } = mfaCodeSchema.parse(await c.req.json());
  const user = await currentUser(principal.userId);
  if (user.mfaEnabledAt) throw errors.validation('MFA is already enabled');
  if (!user.mfaSecret) throw errors.validation('Run MFA setup first');
  if (!(await verifyTotp(user.mfaSecret, code))) throw errors.unauthorized('Invalid MFA code');

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
  await db
    .update(users)
    .set({ mfaEnabledAt: new Date(), mfaRecoveryCodes: hashes })
    .where(eq(users.id, user.id));
  await recordAudit({
    tenantId: principal.tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'user.mfa_enabled',
    target: 'user',
    targetId: user.id,
  });
  return c.json({ enabled: true, recoveryCodes });
});

// Disabling requires proving possession: a current TOTP code or a recovery code.
meRoutes.post('/mfa/disable', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not have MFA');
  const { code } = mfaCodeSchema.parse(await c.req.json());
  const user = await currentUser(principal.userId);
  if (!user.mfaSecret || !user.mfaEnabledAt) throw errors.validation('MFA is not enabled');

  let valid = await verifyTotp(user.mfaSecret, code);
  if (!valid && user.mfaRecoveryCodes?.length) {
    valid = user.mfaRecoveryCodes.includes(await hashRecoveryCode(code));
  }
  if (!valid) throw errors.unauthorized('Invalid MFA code');

  await db
    .update(users)
    .set({ mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: null })
    .where(eq(users.id, user.id));
  await recordAudit({
    tenantId: principal.tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'user.mfa_disabled',
    target: 'user',
    targetId: user.id,
  });
  return c.json({ enabled: false });
});

// Revoke every still-active refresh session for the current user (logs out
// every device). Safe-by-default if asked to keep the current one.
meRoutes.post('/sessions/revoke-all', async (c) => {
  const principal = c.get('principal');
  if (!principal.userId) throw errors.forbidden('API keys do not own sessions');
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, principal.userId), isNull(sessions.revokedAt)));
  await recordAudit({
    tenantId: principal.tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'user.sessions_revoked',
    target: 'user',
    targetId: principal.userId,
  });
  return c.json({ ok: true });
});
