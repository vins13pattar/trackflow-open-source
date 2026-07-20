/**
 * SCIM 2.0 user provisioning (RFC 7644). Enterprise IdPs (Okta, Azure AD,
 * OneLogin, JumpCloud, etc.) call these endpoints to push their workforce
 * into TrackFlow.
 *
 * Auth: the IdP sends `Authorization: Bearer <token>`. The token is just an
 * API key with the `scim:provision` scope — admins mint it from the regular
 * /api-keys endpoint and paste it into their IdP. (The same API key can NOT
 * be used here without that scope.)
 *
 * We implement the resources/messages a real IdP uses in production:
 *   - GET    /scim/v2/ServiceProviderConfig
 *   - GET    /scim/v2/ResourceTypes
 *   - GET    /scim/v2/Schemas
 *   - GET    /scim/v2/Users (filter=userName eq "x")
 *   - GET    /scim/v2/Users/:id
 *   - POST   /scim/v2/Users
 *   - PUT    /scim/v2/Users/:id (full replace)
 *   - PATCH  /scim/v2/Users/:id (op=replace on active/name/etc.)
 *   - DELETE /scim/v2/Users/:id
 *
 * Errors are returned in the SCIM error shape (urn:...:Error) — not the
 * platform-default JSON envelope — so IdPs parse them correctly.
 */
import {
  and,
  apiKeys,
  eq,
  desc,
  ilike,
  orgMemberships,
  sql,
  users,
  withSystem,
} from '@trackflow/db';
import {
  apiKeyParts,
  errors,
  hashPassword,
  type Role,
  roles,
} from '@trackflow/shared';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { recordAudit } from '../audit-log.js';
import { db } from '../db.js';

export const scimRoutes = new Hono<{
  Variables: { scimTenantId: string };
}>();

const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

const SCIM_CT = 'application/scim+json';

function scimError(c: Context, status: number, detail: string, scimType?: string): Response {
  return c.json(
    {
      schemas: [SCHEMA_ERROR],
      detail,
      status: String(status),
      ...(scimType ? { scimType } : {}),
    },
    status as never,
    { 'content-type': SCIM_CT },
  );
}

const scimAuth: MiddlewareHandler<{ Variables: { scimTenantId: string } }> = async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : c.req.header('x-api-key');
  if (!token) return scimError(c, 401, 'Missing bearer token', 'invalidCredentials');
  const { prefix, hash } = await apiKeyParts(token);
  const row = await withSystem(db, async (tx) => {
    const [k] = await tx.select().from(apiKeys).where(eq(apiKeys.prefix, prefix));
    if (!k || k.revokedAt || k.keyHash !== hash) return null;
    await tx.update(apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(apiKeys.id, k.id));
    return k;
  });
  if (!row) return scimError(c, 401, 'Invalid token', 'invalidCredentials');
  if (!row.scopes.includes('scim:provision')) {
    return scimError(c, 403, 'Token is missing the scim:provision scope', 'insufficient_scope');
  }
  c.set('scimTenantId', row.tenantId);
  return next();
};

interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
  emails: Array<{ value: string; primary?: boolean; type?: string }>;
  active: boolean;
  meta: { resourceType: 'User'; created: string; lastModified: string; location: string };
}

function toScim(row: { id: string; email: string; name: string; createdAt: Date }, baseUrl: string): ScimUser {
  const [givenName, ...rest] = row.name.split(' ');
  const familyName = rest.join(' ') || undefined;
  return {
    schemas: [SCHEMA_USER],
    id: row.id,
    userName: row.email,
    name: { givenName: givenName || undefined, familyName },
    displayName: row.name,
    emails: [{ value: row.email, primary: true, type: 'work' }],
    active: true,
    meta: {
      resourceType: 'User',
      created: row.createdAt.toISOString(),
      lastModified: row.createdAt.toISOString(),
      location: `${baseUrl}/Users/${row.id}`,
    },
  };
}

function fullName(name?: { givenName?: string; familyName?: string }, displayName?: string, userName?: string): string {
  if (displayName?.trim()) return displayName.trim();
  const parts = [name?.givenName, name?.familyName].filter(Boolean).join(' ').trim();
  return parts || userName || 'User';
}

function clampRole(role: string | undefined): Role {
  return (roles as readonly string[]).includes(role ?? '') ? (role as Role) : 'user';
}

scimRoutes.use('*', scimAuth);

scimRoutes.get('/ServiceProviderConfig', (c) =>
  c.json(
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'Authorization: Bearer <api-key-with-scim:provision-scope>',
          primary: true,
        },
      ],
    },
    200,
    { 'content-type': SCIM_CT },
  ),
);

scimRoutes.get('/ResourceTypes', (c) =>
  c.json(
    {
      schemas: [SCHEMA_LIST],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCHEMA_USER,
        },
      ],
    },
    200,
    { 'content-type': SCIM_CT },
  ),
);

scimRoutes.get('/Schemas', (c) =>
  c.json(
    {
      schemas: [SCHEMA_LIST],
      totalResults: 1,
      Resources: [{ id: SCHEMA_USER, name: 'User', description: 'TrackFlow user' }],
    },
    200,
    { 'content-type': SCIM_CT },
  ),
);

scimRoutes.get('/Users', async (c) => {
  const tenantId = c.get('scimTenantId');
  const filter = c.req.query('filter');
  const startIndex = Math.max(1, Number(c.req.query('startIndex') ?? 1));
  const count = Math.min(200, Math.max(1, Number(c.req.query('count') ?? 100)));
  const baseUrl = new URL(c.req.url);
  const base = `${baseUrl.origin}/scim/v2`;

  // We support the one filter Azure AD / Okta send: `userName eq "x"`.
  const eqMatch = filter?.match(/^userName\s+eq\s+"([^"]+)"$/i);
  const where = eqMatch
    ? and(eq(users.tenantId, tenantId), ilike(users.email, eqMatch[1]!))
    : eq(users.tenantId, tenantId);

  const total = await db.select({ n: sql<string>`count(*)` }).from(users).where(where);
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .offset(startIndex - 1)
    .limit(count);

  return c.json(
    {
      schemas: [SCHEMA_LIST],
      totalResults: Number(total[0]?.n ?? 0),
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map((r) => toScim(r, base)),
    },
    200,
    { 'content-type': SCIM_CT },
  );
});

scimRoutes.get('/Users/:id', async (c) => {
  const tenantId = c.get('scimTenantId');
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.id, c.req.param('id')), eq(users.tenantId, tenantId)));
  if (!row) return scimError(c, 404, 'User not found');
  const base = `${new URL(c.req.url).origin}/scim/v2`;
  return c.json(toScim(row, base), 200, { 'content-type': SCIM_CT });
});

interface ScimUserPayload {
  userName: string;
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
  emails?: Array<{ value: string; primary?: boolean }>;
  active?: boolean;
  // Non-standard extension: pass a TrackFlow role on create.
  ['urn:ietf:params:scim:schemas:extension:trackflow:2.0:User']?: { role?: string };
}

scimRoutes.post('/Users', async (c) => {
  const tenantId = c.get('scimTenantId');
  let body: ScimUserPayload;
  try {
    body = (await c.req.json()) as ScimUserPayload;
  } catch {
    return scimError(c, 400, 'Body must be valid JSON', 'invalidSyntax');
  }
  if (!body?.userName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.userName)) {
    return scimError(c, 400, 'userName must be a valid email', 'invalidValue');
  }
  const email = body.userName.toLowerCase();
  const name = fullName(body.name, body.displayName, email);
  const role = clampRole(body['urn:ietf:params:scim:schemas:extension:trackflow:2.0:User']?.role);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.tenantId, tenantId)));
  if (existing) return scimError(c, 409, 'User already exists', 'uniqueness');

  // IdP-provisioned accounts get a random opaque password (the user signs in via
  // their IdP / SSO, not this hash); we never surface it.
  const tempPassword = crypto.randomUUID() + crypto.randomUUID();
  try {
    const [row] = await db
      .insert(users)
      .values({
        tenantId,
        email,
        name,
        role,
        passwordHash: await hashPassword(tempPassword),
      })
      .returning({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt });
    await db
      .insert(orgMemberships)
      .values({ userId: row!.id, tenantId, role })
      .onConflictDoNothing();
    await recordAudit({
      tenantId,
      actorUserId: null,
      actorIp: c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for') ?? null,
      action: 'scim.user.created',
      target: 'user',
      targetId: row!.id,
      metadata: { email, role },
    });
    const base = `${new URL(c.req.url).origin}/scim/v2`;
    return c.json(toScim(row!, base), 201, { 'content-type': SCIM_CT, location: `${base}/Users/${row!.id}` });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return scimError(c, 409, 'Email already in use across the platform', 'uniqueness');
    }
    throw err;
  }
});

scimRoutes.put('/Users/:id', async (c) => {
  const tenantId = c.get('scimTenantId');
  const id = c.req.param('id');
  let body: ScimUserPayload;
  try {
    body = (await c.req.json()) as ScimUserPayload;
  } catch {
    return scimError(c, 400, 'Body must be valid JSON', 'invalidSyntax');
  }
  if (!body?.userName) return scimError(c, 400, 'userName is required', 'invalidValue');

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  if (!existing) return scimError(c, 404, 'User not found');

  // If active=false on PUT, treat as deprovision (same as DELETE).
  if (body.active === false) {
    await db.delete(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    await recordAudit({
      tenantId,
      actorUserId: null,
      actorIp: c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for') ?? null,
      action: 'scim.user.deprovisioned',
      target: 'user',
      targetId: id,
      metadata: { via: 'PUT active=false' },
    });
    return c.body(null, 204);
  }

  const name = fullName(body.name, body.displayName, body.userName);
  const [updated] = await db
    .update(users)
    .set({ email: body.userName.toLowerCase(), name })
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .returning({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt });
  const base = `${new URL(c.req.url).origin}/scim/v2`;
  return c.json(toScim(updated!, base), 200, { 'content-type': SCIM_CT });
});

interface ScimPatch {
  schemas: string[];
  Operations: Array<{ op: string; path?: string; value?: unknown }>;
}

scimRoutes.patch('/Users/:id', async (c) => {
  const tenantId = c.get('scimTenantId');
  const id = c.req.param('id');
  let body: ScimPatch;
  try {
    body = (await c.req.json()) as ScimPatch;
  } catch {
    return scimError(c, 400, 'Body must be valid JSON', 'invalidSyntax');
  }
  if (!Array.isArray(body?.Operations)) return scimError(c, 400, 'Operations array is required', 'invalidValue');

  const [existing] = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  if (!existing) return scimError(c, 404, 'User not found');

  // Apply a minimal set of operations IdPs actually send:
  //   - replace active=false  → deprovision (delete + audit)
  //   - replace displayName/name → rename
  //   - replace userName → email change
  let deactivated = false;
  let nextName = existing.name;
  let nextEmail = existing.email;
  for (const op of body.Operations) {
    if (op.op?.toLowerCase() !== 'replace') continue;
    const path = op.path ?? '';
    const value = op.value as Record<string, unknown> | string | boolean | undefined;
    if (path === 'active' && value === false) deactivated = true;
    else if (typeof value === 'object' && value && 'active' in value && (value as { active: unknown }).active === false) deactivated = true;
    else if (path === 'displayName' && typeof value === 'string') nextName = value;
    else if (typeof value === 'object' && value && 'displayName' in value && typeof (value as { displayName: unknown }).displayName === 'string') {
      nextName = (value as { displayName: string }).displayName;
    }
    else if (path === 'name.givenName' && typeof value === 'string') nextName = `${value} ${nextName.split(' ').slice(1).join(' ')}`.trim();
    else if (path === 'userName' && typeof value === 'string') nextEmail = value.toLowerCase();
  }

  if (deactivated) {
    await db.delete(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
    await recordAudit({
      tenantId,
      actorUserId: null,
      actorIp: c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for') ?? null,
      action: 'scim.user.deprovisioned',
      target: 'user',
      targetId: id,
      metadata: { via: 'PATCH active=false' },
    });
    return c.body(null, 204);
  }
  if (nextName !== existing.name || nextEmail !== existing.email) {
    await db
      .update(users)
      .set({ name: nextName, email: nextEmail })
      .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  }
  const [refreshed] = await db
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
  const base = `${new URL(c.req.url).origin}/scim/v2`;
  return c.json(toScim(refreshed!, base), 200, { 'content-type': SCIM_CT });
});

scimRoutes.delete('/Users/:id', async (c) => {
  const tenantId = c.get('scimTenantId');
  const id = c.req.param('id');
  const result = await db
    .delete(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .returning({ id: users.id });
  if (result.length === 0) return scimError(c, 404, 'User not found');
  await recordAudit({
    tenantId,
    actorUserId: null,
    actorIp: c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for') ?? null,
    action: 'scim.user.deprovisioned',
    target: 'user',
    targetId: id,
    metadata: { via: 'DELETE' },
  });
  return c.body(null, 204);
});

// PATCH may include a placeholder reference so unused-import warnings stay clean.
void SCHEMA_PATCH;
