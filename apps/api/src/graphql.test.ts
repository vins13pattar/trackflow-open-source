import { devices, eq, tenants, users, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './env.js';

const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('GraphQL endpoint', () => {
  const app = createApp();
  let tenantId: string;
  let otherTenantId: string;
  let token: string;

  async function gql(query: string, variables?: Record<string, unknown>) {
    return app.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
  }

  beforeAll(async () => {
    const stamp = Date.now();
    const [t] = await db.insert(tenants).values({ name: 'GQL Co', slug: `gql-${stamp}` }).returning();
    tenantId = t!.id;
    const [other] = await db.insert(tenants).values({ name: 'Other', slug: `gql-other-${stamp}` }).returning();
    otherTenantId = other!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `gql-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    token = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
    // Seed each tenant with one device.
    await withSystem(db, (tx) =>
      tx.insert(devices).values([
        { tenantId, name: 'My truck', imei: `imei-mine-${stamp}` },
        { tenantId: otherTenantId, name: 'Other truck', imei: `imei-other-${stamp}` },
      ]),
    );
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) {
      if (id) {
        await withSystem(db, (tx) => tx.delete(devices).where(eq(devices.tenantId, id)));
        await db.delete(tenants).where(eq(tenants.id, id));
      }
    }
  });

  it('rejects an unauthenticated GraphQL request', async () => {
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ me { id } }' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns the authenticated principal via { me }', async () => {
    const res = await gql('{ me { id role } }');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { me: { id: string; role: string } } };
    expect(body.data.me.role).toBe('owner');
    expect(body.data.me.id).toBeTruthy();
  });

  it('lists only the current tenant\'s devices (RLS enforced inside resolvers)', async () => {
    const res = await gql('{ devices { id name imei } }');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { devices: Array<{ name: string; imei: string }> } };
    expect(body.data.devices).toHaveLength(1);
    expect(body.data.devices[0]!.name).toBe('My truck');
  });

  it('returns a single device by id, but null for a cross-tenant id', async () => {
    const list = (await (await gql('{ devices { id } }')).json()) as { data: { devices: Array<{ id: string }> } };
    const myId = list.data.devices[0]!.id;
    const ok = (await (await gql(`{ device(id: "${myId}") { name } }`)).json()) as {
      data: { device: { name: string } | null };
    };
    expect(ok.data.device?.name).toBe('My truck');

    // Get the foreign device id (using a system tx so RLS doesn't filter).
    const [foreign] = await withSystem(db, (tx) =>
      tx.select({ id: devices.id }).from(devices).where(eq(devices.tenantId, otherTenantId)),
    );
    const cross = (await (await gql(`{ device(id: "${foreign!.id}") { name } }`)).json()) as {
      data: { device: { name: string } | null };
    };
    expect(cross.data.device).toBeNull();
  });

  it('reports field validation errors in the GraphQL response body', async () => {
    const res = await gql('{ devices(status: "active") { nope } }');
    // graphql-yoga returns 200 with `errors` in the body for graphql-level
    // validation failures (per the GraphQL-over-HTTP spec when the request
    // is otherwise well-formed JSON).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: Array<{ message: string }> };
    expect(body.errors[0]!.message).toMatch(/Cannot query field "nope"/);
  });
});
