/**
 * SAML 2.0 SSO routes.
 *
 *   Tenant admin (JWT-authenticated, requires `users:manage`):
 *     GET    /saml-config     → current config (certificate redacted)
 *     PUT    /saml-config     → create or replace config
 *     DELETE /saml-config     → disable SSO
 *
 *   Public SAML flow (unauthenticated; tenant resolved from URL slug):
 *     GET    /auth/saml/:slug/metadata  → SP metadata XML for the IdP
 *     GET    /auth/saml/:slug/login     → 302 to IdP entry URL with AuthnRequest
 *     POST   /auth/saml/:slug/acs       → Assertion Consumer Service.
 *                                          Verifies signature, looks up / JIT-
 *                                          provisions the user, issues TrackFlow
 *                                          tokens, and 302s to the dashboard
 *                                          with the access token in the fragment.
 */
import {
  and,
  eq,
  orgMemberships,
  samlConfigs,
  sessions,
  tenants,
  users,
  withSystem,
} from '@trackflow/db';
import { errors, hashPassword, issueTokens, type Role } from '@trackflow/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { db } from '../db.js';
import { env } from '../env.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { buildSamlClient, extractProfile } from '../saml.js';

export const samlConfigRoutes = new Hono<AppEnv>();
export const samlPublicRoutes = new Hono();

// ---------- Tenant-admin config ----------

samlConfigRoutes.use('*', requirePermission('users:manage'));

const upsertSchema = z.object({
  enabled: z.boolean().default(true),
  entityId: z.string().min(4).max(500),
  ssoUrl: z.string().url(),
  certificate: z.string().min(20),
  attributeEmail: z.string().min(1).max(200).default('email'),
  attributeName: z.string().min(1).max(200).default('displayName'),
  defaultRole: z.enum(['owner', 'admin', 'manager', 'user', 'viewer']).default('user'),
});

function publicConfig(row: typeof samlConfigs.$inferSelect) {
  return {
    enabled: row.enabled,
    entityId: row.entityId,
    ssoUrl: row.ssoUrl,
    // Never echo the IdP cert through the API; it's stored, not displayed.
    certificateFingerprintSha1: null as string | null,
    audience: row.audience,
    acsUrl: row.acsUrl,
    attributeEmail: row.attributeEmail,
    attributeName: row.attributeName,
    defaultRole: row.defaultRole,
    updatedAt: row.updatedAt.toISOString(),
  };
}

samlConfigRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const [row] = await withSystem(db, (tx) =>
    tx.select().from(samlConfigs).where(eq(samlConfigs.tenantId, tenantId)),
  );
  if (!row) return c.json({ enabled: false, configured: false });
  return c.json({ configured: true, ...publicConfig(row) });
});

samlConfigRoutes.put('/', async (c) => {
  const { tenantId } = c.get('principal');
  const body = upsertSchema.parse(await c.req.json());
  const [tenant] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw errors.notFound('Tenant not found');
  const audience = `${env.webOrigin}/auth/saml/${tenant.slug}/metadata`;
  const acsUrl = `${env.webOrigin}/auth/saml/${tenant.slug}/acs`;

  const row = await withSystem(db, async (tx) => {
    const [existing] = await tx.select().from(samlConfigs).where(eq(samlConfigs.tenantId, tenantId));
    if (existing) {
      const [u] = await tx
        .update(samlConfigs)
        .set({
          enabled: body.enabled,
          entityId: body.entityId,
          ssoUrl: body.ssoUrl,
          certificate: body.certificate,
          audience,
          acsUrl,
          attributeEmail: body.attributeEmail,
          attributeName: body.attributeName,
          defaultRole: body.defaultRole,
          updatedAt: new Date(),
        })
        .where(eq(samlConfigs.tenantId, tenantId))
        .returning();
      return u!;
    }
    const [u] = await tx
      .insert(samlConfigs)
      .values({
        tenantId,
        enabled: body.enabled,
        entityId: body.entityId,
        ssoUrl: body.ssoUrl,
        certificate: body.certificate,
        audience,
        acsUrl,
        attributeEmail: body.attributeEmail,
        attributeName: body.attributeName,
        defaultRole: body.defaultRole,
      })
      .returning();
    return u!;
  });

  await recordAudit({
    tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'saml.config.updated',
    target: 'saml_config',
    metadata: { enabled: body.enabled, entityId: body.entityId },
  });
  return c.json({ configured: true, ...publicConfig(row) });
});

samlConfigRoutes.delete('/', async (c) => {
  const { tenantId } = c.get('principal');
  await withSystem(db, (tx) => tx.delete(samlConfigs).where(eq(samlConfigs.tenantId, tenantId)));
  await recordAudit({
    tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'saml.config.deleted',
    target: 'saml_config',
  });
  return c.body(null, 204);
});

// ---------- Public SAML flow ----------

async function loadTenantAndConfig(slug: string) {
  const [t] = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.slug, slug));
  if (!t) return null;
  const [cfg] = await withSystem(db, (tx) =>
    tx.select().from(samlConfigs).where(eq(samlConfigs.tenantId, t.id)),
  );
  if (!cfg || !cfg.enabled) return null;
  return { tenant: t, cfg };
}

samlPublicRoutes.get('/:slug/metadata', async (c) => {
  const ctx = await loadTenantAndConfig(c.req.param('slug'));
  if (!ctx) throw errors.notFound('SSO not configured for this workspace');
  const xml = buildSamlClient(ctx.cfg).generateServiceProviderMetadata(null);
  return new Response(xml, { status: 200, headers: { 'content-type': 'application/samlmetadata+xml' } });
});

samlPublicRoutes.get('/:slug/login', async (c) => {
  const ctx = await loadTenantAndConfig(c.req.param('slug'));
  if (!ctx) throw errors.notFound('SSO not configured for this workspace');
  const url = await buildSamlClient(ctx.cfg).getAuthorizeUrlAsync('', '', {});
  return c.redirect(url, 302);
});

interface JitUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: Role;
}

async function findOrCreateUser(tenantId: string, email: string, name: string, defaultRole: Role): Promise<JitUser> {
  const [existing] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(and(eq(users.email, email), eq(users.tenantId, tenantId)));
  if (existing) return { ...existing, role: existing.role as Role };

  const opaque = crypto.randomUUID() + crypto.randomUUID();
  const [created] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      name,
      role: defaultRole,
      passwordHash: await hashPassword(opaque),
    })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role, tenantId: users.tenantId });
  await db
    .insert(orgMemberships)
    .values({ userId: created!.id, tenantId, role: defaultRole })
    .onConflictDoNothing();
  return { ...created!, role: created!.role as Role };
}

samlPublicRoutes.post('/:slug/acs', async (c) => {
  const ctx = await loadTenantAndConfig(c.req.param('slug'));
  if (!ctx) throw errors.notFound('SSO not configured for this workspace');
  const form = await c.req.parseBody();
  const samlResponse = String(form.SAMLResponse ?? '');
  const relayState = String(form.RelayState ?? '');
  if (!samlResponse) throw errors.validation('Missing SAMLResponse');

  let profile: { attributes?: Record<string, unknown>; nameID?: string };
  try {
    const result = await buildSamlClient(ctx.cfg).validatePostResponseAsync({
      SAMLResponse: samlResponse,
      RelayState: relayState,
    });
    profile = result.profile ?? {};
  } catch (err) {
    throw errors.unauthorized(`SAML response failed validation: ${(err as Error).message}`);
  }

  const extracted = extractProfile(ctx.cfg, profile.attributes, profile.nameID);
  if (!extracted) throw errors.unauthorized('SAML assertion missing email attribute');

  const user = await findOrCreateUser(ctx.tenant.id, extracted.email, extracted.name, ctx.cfg.defaultRole as Role);
  const { jti, ...tokens } = await issueTokens({ sub: user.id, tid: user.tenantId, role: user.role }, env.jwt);
  await db.insert(sessions).values({
    id: jti,
    userId: user.id,
    tenantId: user.tenantId,
    expiresAt: new Date(Date.now() + env.jwt.refreshTtl * 1000),
  });
  await recordAudit({
    tenantId: user.tenantId,
    actorUserId: null,
    actorIp: c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for') ?? null,
    action: 'auth.saml_login',
    target: 'user',
    targetId: user.id,
    metadata: { email: user.email },
  });

  // Hand the tokens to the SPA via the URL fragment so they're not in any
  // server log; RelayState (if the IdP echoed one) becomes the post-login
  // destination, sanitised to in-app paths only.
  const dest = relayState && relayState.startsWith('/') ? relayState : '/';
  const dashUrl = new URL(dest, env.webOrigin);
  dashUrl.hash = `access_token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}`;
  return c.redirect(dashUrl.toString(), 302);
});
