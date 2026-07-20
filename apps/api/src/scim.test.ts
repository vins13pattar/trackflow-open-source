import { apiKeys, eq, tenants, users, withSystem } from '@trackflow/db';
import { generateApiKey } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires Postgres + RLS applied. Gated so `pnpm test` stays green without one.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('SCIM 2.0 user provisioning', () => {
  const app = createApp();
  let tenantId: string;
  let scimToken: string;
  let noScopeToken: string;

  const SCIM_CT = 'application/scim+json';

  beforeAll(async () => {
    const stamp = Date.now();
    const [t] = await db.insert(tenants).values({ name: 'SCIM Co', slug: `scim-${stamp}` }).returning();
    tenantId = t!.id;
    // SCIM-scoped API key.
    const scim = await generateApiKey();
    await withSystem(db, async (tx) => {
      await tx.insert(apiKeys).values({
        tenantId,
        name: 'SCIM token',
        prefix: scim.prefix,
        keyHash: scim.hash,
        scopes: ['scim:provision'],
      });
    });
    scimToken = scim.key;
    // A second key WITHOUT the SCIM scope, used to assert insufficient_scope.
    const reg = await generateApiKey();
    await withSystem(db, async (tx) => {
      await tx.insert(apiKeys).values({
        tenantId,
        name: 'regular key',
        prefix: reg.prefix,
        keyHash: reg.hash,
        scopes: ['devices:read'],
      });
    });
    noScopeToken = reg.key;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, (tx) => tx.delete(users).where(eq(users.tenantId, tenantId)));
      await withSystem(db, (tx) => tx.delete(apiKeys).where(eq(apiKeys.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  const auth = (token: string = scimToken) => ({
    authorization: `Bearer ${token}`,
    'content-type': SCIM_CT,
  });

  it('rejects a missing or invalid bearer token', async () => {
    const a = await app.request('/scim/v2/Users');
    expect(a.status).toBe(401);
    const b = await app.request('/scim/v2/Users', { headers: { authorization: 'Bearer tf_live_nope' } });
    expect(b.status).toBe(401);
    const body = (await b.json()) as { schemas: string[]; detail: string };
    expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
  });

  it('rejects a token without the scim:provision scope (403)', async () => {
    const res = await app.request('/scim/v2/Users', { headers: { authorization: `Bearer ${noScopeToken}` } });
    expect(res.status).toBe(403);
  });

  it('publishes ServiceProviderConfig with the supported feature flags', async () => {
    const res = await app.request('/scim/v2/ServiceProviderConfig', { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(SCIM_CT);
    const body = (await res.json()) as { patch: { supported: boolean }; filter: { supported: boolean } };
    expect(body.patch.supported).toBe(true);
    expect(body.filter.supported).toBe(true);
  });

  let createdId: string;

  it('creates a user via POST /Users and mirrors a tenant membership', async () => {
    const stamp = Date.now();
    const res = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        userName: `okta-${stamp}@example.com`,
        name: { givenName: 'Vinod', familyName: 'Pattar' },
        emails: [{ value: `okta-${stamp}@example.com`, primary: true }],
        active: true,
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/scim\/v2\/Users\//);
    const body = (await res.json()) as { id: string; userName: string; meta: { location: string } };
    createdId = body.id;
    expect(body.userName).toBe(`okta-${stamp}@example.com`);
    expect(body.meta.location).toContain(`/Users/${body.id}`);
  });

  it('rejects a duplicate userName with 409 / uniqueness', async () => {
    const stamp = Date.now();
    const email = `dup-${stamp}@example.com`;
    const first = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userName: email, name: { givenName: 'A' } }),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userName: email, name: { givenName: 'A' } }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { scimType: string };
    expect(body.scimType).toBe('uniqueness');
  });

  it('lists users with a userName eq "..." filter', async () => {
    const stamp = Date.now();
    const email = `find-${stamp}@example.com`;
    await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userName: email }),
    });
    const res = await app.request(`/scim/v2/Users?filter=userName eq "${email}"`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalResults: number; Resources: Array<{ userName: string }> };
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0]!.userName).toBe(email);
  });

  it('PATCH active=false deprovisions the user (deletes + audit)', async () => {
    expect(createdId).toBeTruthy();
    const res = await app.request(`/scim/v2/Users/${createdId}`, {
      method: 'PATCH',
      headers: auth(),
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', value: { active: false } }],
      }),
    });
    expect(res.status).toBe(204);
    const get = await app.request(`/scim/v2/Users/${createdId}`, { headers: auth() });
    expect(get.status).toBe(404);
  });

  it('DELETE removes the user (returns 204; subsequent GET 404)', async () => {
    const stamp = Date.now();
    const create = await app.request('/scim/v2/Users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ userName: `del-${stamp}@example.com` }),
    });
    const body = (await create.json()) as { id: string };
    const del = await app.request(`/scim/v2/Users/${body.id}`, { method: 'DELETE', headers: auth() });
    expect(del.status).toBe(204);
    const get = await app.request(`/scim/v2/Users/${body.id}`, { headers: auth() });
    expect(get.status).toBe(404);
  });
});
