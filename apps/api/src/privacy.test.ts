import { devices, eq, tenants, users } from '@trackflow/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

type Tokens = { accessToken: string; refreshToken: string };

describe.skipIf(!enabled)('privacy: DSR export + workspace hard-delete', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  const json = (body: unknown, token?: string, method = 'POST') => ({
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  async function register(password = 'password123') {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `dsr-${stamp}@example.com`;
    const res = await app.request('/auth/register', json({ email, password, name: 'DSR Owner', tenantName: `Org ${stamp}` }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { id: string; tenantId: string }; tokens: Tokens };
    tenantIds.push(body.user.tenantId);
    return { email, password, ...body };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('exports the tenant bundle with sanitized members and own data only', async () => {
    const a = await register();
    const b = await register();

    const dev = await app.request(
      '/devices',
      json({ name: 'Truck A', imei: '865432019876111', type: 'vehicle', protocol: 'gt06' }, a.tokens.accessToken),
    );
    expect(dev.status).toBe(201);

    const res = await app.request('/me/export', { headers: { authorization: `Bearer ${a.tokens.accessToken}` } });
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as {
      tenant: { id: string };
      users: Array<{ email: string; passwordHash?: string }>;
      devices: Array<{ imei: string }>;
      positionsTruncated: boolean;
    };
    expect(bundle.tenant.id).toBe(a.user.tenantId);
    expect(bundle.users.map((u) => u.email)).toContain(a.email);
    expect(bundle.users.map((u) => u.email)).not.toContain(b.email); // RLS / tenant scoping
    expect(bundle.users[0]!.passwordHash).toBeUndefined(); // sanitized
    expect(bundle.devices.map((d) => d.imei)).toContain('865432019876111');
    expect(bundle.positionsTruncated).toBe(false);
  });

  it('refuses export for non-owners', async () => {
    const { tokens } = await register();
    const invite = await app.request('/users', json({ email: `viewer-${Date.now()}@example.com`, name: 'V', role: 'viewer' }, tokens.accessToken));
    const { tempPassword, user } = (await invite.json()) as { tempPassword: string; user: { email: string } };
    const login = await app.request('/auth/login', json({ email: user.email, password: tempPassword }));
    const { tokens: viewerTokens } = (await login.json()) as { tokens: Tokens };
    const res = await app.request('/me/export', { headers: { authorization: `Bearer ${viewerTokens.accessToken}` } });
    expect(res.status).toBe(403);
  });

  it('hard-deletes the workspace only with the right password + phrase', async () => {
    const { email, password, tokens, user } = await register();
    await app.request('/devices', json({ name: 'T', imei: '865432019876222', type: 'vehicle', protocol: 'gt06' }, tokens.accessToken));

    const wrongPhrase = await app.request('/me/tenant', json({ password, confirm: 'nope' }, tokens.accessToken, 'DELETE'));
    expect(wrongPhrase.status).toBe(400);
    const wrongPassword = await app.request('/me/tenant', json({ password: 'wrong-password1', confirm: 'delete my workspace' }, tokens.accessToken, 'DELETE'));
    expect(wrongPassword.status).toBe(401);

    const del = await app.request('/me/tenant', json({ password, confirm: 'delete my workspace' }, tokens.accessToken, 'DELETE'));
    expect(del.status).toBe(204);

    // Tenant row, cascaded rows, and the login are all gone.
    expect((await db.select().from(tenants).where(eq(tenants.id, user.tenantId))).length).toBe(0);
    expect((await db.select().from(users).where(eq(users.tenantId, user.tenantId))).length).toBe(0);
    expect((await db.select().from(devices).where(eq(devices.tenantId, user.tenantId))).length).toBe(0);
    const login = await app.request('/auth/login', json({ email, password }));
    expect(login.status).toBe(401);
  });
});
