import { and, eq, isNull, orgMemberships, sessions, tenants, users } from '@trackflow/db';
import {
  errors,
  forgotPasswordSchema,
  hashPassword,
  hashRecoveryCode,
  issueTokens,
  loginSchema,
  mfaVerifySchema,
  type PublicUser,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  type Role,
  verifyEmailSchema,
  verifyPassword,
  verifyToken,
  verifyTotp,
} from '@trackflow/shared';
import { Hono } from 'hono';
import { consumeAuthToken, issueAuthToken, peekAuthToken } from '../auth-tokens.js';
import { db } from '../db.js';
import { sendEmail } from '../email.js';
import { env } from '../env.js';

export const authRoutes = new Hono();

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'org'}-${Math.random().toString(36).slice(2, 7)}`;
}

function publicUser(u: { id: string; email: string; name: string; role: string; tenantId: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role, tenantId: u.tenantId };
}

/** Records a refresh-token session keyed on the token's jti. */
async function recordSession(jti: string, userId: string, tenantId: string): Promise<void> {
  await db.insert(sessions).values({
    id: jti,
    userId,
    tenantId,
    expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
  });
}

authRoutes.post('/register', async (c) => {
  const body = registerSchema.parse(await c.req.json());

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
  if (existing.length > 0) throw errors.duplicate('Email already registered');

  const trialEndsAt = new Date(Date.now() + env.trial.days * 86_400_000);
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: body.tenantName,
      slug: slugify(body.tenantName),
      plan: env.trial.plan,
      subscriptionStatus: 'trialing',
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant!.id,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      name: body.name,
      role: 'owner',
    })
    .returning();

  // Mirror the new tenant/user pair into org_memberships so the multi-org
  // membership listing + switch flow both see this user from day one.
  await db
    .insert(orgMemberships)
    .values({ userId: user!.id, tenantId: tenant!.id, role: user!.role })
    .onConflictDoNothing();

  const { jti, ...tokens } = await issueTokens({ sub: user!.id, tid: tenant!.id, role: user!.role }, env.jwt);
  await recordSession(jti, user!.id, tenant!.id);

  // Kick off email verification (best-effort; delivery is a no-op without a key).
  const emailToken = await issueAuthToken(user!.id, 'email_verify', 86_400);
  void sendEmail(
    user!.email,
    'Verify your TrackFlow email',
    `Verify your email: ${env.webOrigin}/verify-email?token=${emailToken}\n\nThis link expires in 24 hours.`,
  ).catch(() => {});

  return c.json({ user: publicUser(user!), tokens }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = loginSchema.parse(await c.req.json());
  const [user] = await db.select().from(users).where(eq(users.email, body.email));
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw errors.unauthorized('Invalid email or password');
  }

  // MFA-enrolled users get a short-lived challenge instead of tokens; the
  // session is only minted by /auth/mfa/verify with a valid code.
  if (user.mfaEnabledAt) {
    const mfaToken = await issueAuthToken(user.id, 'mfa_challenge', 300);
    return c.json({ mfaRequired: true, mfaToken });
  }

  const { jti, ...tokens } = await issueTokens({ sub: user.id, tid: user.tenantId, role: user.role }, env.jwt);
  await recordSession(jti, user.id, user.tenantId);

  // Tenant policy: when the workspace requires MFA and this user has none,
  // flag it so the dashboard routes them straight to enrollment.
  const [tenant] = await db
    .select({ requireMfa: tenants.requireMfa })
    .from(tenants)
    .where(eq(tenants.id, user.tenantId));
  const mfaSetupRequired = !!tenant?.requireMfa;

  return c.json({ user: publicUser(user), tokens, ...(mfaSetupRequired ? { mfaSetupRequired } : {}) });
});

// Completes an MFA login: a valid TOTP code (or one-time recovery code)
// exchanges the challenge for real tokens. A wrong code does NOT consume the
// challenge, so the user can retype within the 5-minute window.
authRoutes.post('/mfa/verify', async (c) => {
  const { mfaToken, code } = mfaVerifySchema.parse(await c.req.json());
  const userId = await peekAuthToken('mfa_challenge', mfaToken);
  if (!userId) throw errors.unauthorized('Invalid or expired MFA challenge');

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.mfaSecret || !user.mfaEnabledAt) throw errors.unauthorized('MFA is not enabled');

  let valid = await verifyTotp(user.mfaSecret, code);
  if (!valid && user.mfaRecoveryCodes?.length) {
    const hash = await hashRecoveryCode(code);
    if (user.mfaRecoveryCodes.includes(hash)) {
      valid = true;
      await db
        .update(users)
        .set({ mfaRecoveryCodes: user.mfaRecoveryCodes.filter((h) => h !== hash) })
        .where(eq(users.id, user.id));
    }
  }
  if (!valid) throw errors.unauthorized('Invalid MFA code');

  await consumeAuthToken('mfa_challenge', mfaToken);
  const { jti, ...tokens } = await issueTokens({ sub: user.id, tid: user.tenantId, role: user.role }, env.jwt);
  await recordSession(jti, user.id, user.tenantId);
  return c.json({ user: publicUser(user), tokens });
});

// Rotating refresh: each use revokes the presented session and issues a new one.
// Replay of an already-rotated token is treated as theft and kills the chain.
authRoutes.post('/refresh', async (c) => {
  const body = refreshSchema.parse(await c.req.json());
  const claims = await verifyToken(body.refreshToken, 'refresh', env.jwt);
  if (!claims.jti) throw errors.unauthorized('Invalid refresh token');

  const [session] = await db.select().from(sessions).where(eq(sessions.id, claims.jti));
  if (!session || session.expiresAt < new Date()) throw errors.unauthorized('Refresh token expired');
  if (session.revokedAt) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, session.userId), isNull(sessions.revokedAt)));
    throw errors.unauthorized('Refresh token already used');
  }

  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, claims.jti));
  const { jti, ...tokens } = await issueTokens({ sub: claims.sub, tid: claims.tid, role: claims.role }, env.jwt);
  await recordSession(jti, claims.sub, claims.tid);
  return c.json({ tokens });
});

// Server-side logout: revoke the refresh session. Tolerant of an invalid token.
authRoutes.post('/logout', async (c) => {
  const body = refreshSchema.parse(await c.req.json());
  try {
    const claims = await verifyToken(body.refreshToken, 'refresh', env.jwt);
    if (claims.jti) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, claims.jti));
    }
  } catch {
    // Already-invalid token → nothing to revoke.
  }
  return c.json({ ok: true });
});

// Always 200 (don't reveal whether the email exists); emails a reset link if it does.
authRoutes.post('/password/forgot', async (c) => {
  const { email } = forgotPasswordSchema.parse(await c.req.json());
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) {
    const token = await issueAuthToken(user.id, 'password_reset', 3600);
    void sendEmail(
      email,
      'Reset your TrackFlow password',
      `Reset your password: ${env.webOrigin}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    ).catch(() => {});
  }
  return c.json({ ok: true });
});

authRoutes.post('/password/reset', async (c) => {
  const { token, password } = resetPasswordSchema.parse(await c.req.json());
  const userId = await consumeAuthToken('password_reset', token);
  if (!userId) throw errors.unauthorized('Invalid or expired reset token');
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
  // Force re-login everywhere after a password reset.
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return c.json({ ok: true });
});

authRoutes.post('/verify-email', async (c) => {
  const { token } = verifyEmailSchema.parse(await c.req.json());
  const userId = await consumeAuthToken('email_verify', token);
  if (!userId) throw errors.unauthorized('Invalid or expired verification token');
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return c.json({ ok: true });
});
