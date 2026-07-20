import { eq, tenants, users } from '@trackflow/db';
import { afterAll, describe, expect, it } from 'vitest';
import { issueAuthToken } from './auth-tokens.js';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

type Tokens = { accessToken: string; refreshToken: string };

describe.skipIf(!enabled)('auth: refresh rotation + logout', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  async function register(): Promise<Tokens> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `u-${stamp}@example.com`, password: 'password123', name: 'Test User', tenantName: `Org ${stamp}` }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { tenantId: string }; tokens: Tokens };
    tenantIds.push(body.user.tenantId);
    return body.tokens;
  }

  function refresh(refreshToken: string) {
    return app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const t0 = await register();
    const r1 = await refresh(t0.refreshToken);
    expect(r1.status).toBe(200);
    const { tokens: t1 } = (await r1.json()) as { tokens: Tokens };
    expect(t1.refreshToken).not.toBe(t0.refreshToken);
    expect((await refresh(t0.refreshToken)).status).toBe(401);
  });

  it('treats replay of a rotated token as theft and kills the chain', async () => {
    const t0 = await register();
    const r1 = await refresh(t0.refreshToken);
    const { tokens: t1 } = (await r1.json()) as { tokens: Tokens };
    expect((await refresh(t0.refreshToken)).status).toBe(401); // replay old → reuse detected
    expect((await refresh(t1.refreshToken)).status).toBe(401); // chain revoked
  });

  it('logout revokes the session so the refresh token no longer works', async () => {
    const t0 = await register();
    const lo = await app.request('/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: t0.refreshToken }),
    });
    expect(lo.status).toBe(200);
    expect((await refresh(t0.refreshToken)).status).toBe(401);
  });
});

describe.skipIf(!enabled)('auth: password reset + email verification', () => {
  const app = createApp();
  const tenantIds: string[] = [];
  const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function register(password = 'password123'): Promise<{ userId: string; email: string }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `pr-${stamp}@example.com`;
    const res = await app.request('/auth/register', json({ email, password, name: 'PR', tenantName: `Org ${stamp}` }));
    const body = (await res.json()) as { user: { id: string; tenantId: string } };
    tenantIds.push(body.user.tenantId);
    return { userId: body.user.id, email };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('forgot-password returns 200 for known and unknown emails (no enumeration)', async () => {
    const { email } = await register();
    expect((await app.request('/auth/password/forgot', json({ email }))).status).toBe(200);
    expect((await app.request('/auth/password/forgot', json({ email: 'nobody-xyz@example.com' }))).status).toBe(200);
  });

  it('resets the password with a valid token (single-use) and rotates credentials', async () => {
    const { userId, email } = await register('oldpassword1');
    const token = await issueAuthToken(userId, 'password_reset', 3600);
    expect((await app.request('/auth/password/reset', json({ token, password: 'newpassword1' }))).status).toBe(200);
    expect((await app.request('/auth/login', json({ email, password: 'newpassword1' }))).status).toBe(200);
    expect((await app.request('/auth/login', json({ email, password: 'oldpassword1' }))).status).toBe(401);
    // token cannot be reused
    expect((await app.request('/auth/password/reset', json({ token, password: 'another12345' }))).status).toBe(401);
  });

  it('verifies email with a valid token and rejects a wrong-kind token', async () => {
    const { userId } = await register();
    const token = await issueAuthToken(userId, 'email_verify', 3600);
    expect((await app.request('/auth/verify-email', json({ token }))).status).toBe(200);
    const [u] = await db.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    expect(u!.v).not.toBeNull();
    const wrongKind = await issueAuthToken(userId, 'password_reset', 3600);
    expect((await app.request('/auth/verify-email', json({ token: wrongKind }))).status).toBe(401);
  });
});

describe.skipIf(!enabled)('users: invite + member removal', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  async function ownerToken(): Promise<string> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `own-${stamp}@example.com`, password: 'password123', name: 'Owner', tenantName: `Org ${stamp}` }),
    });
    const body = (await res.json()) as { user: { tenantId: string }; tokens: { accessToken: string } };
    tenantIds.push(body.user.tenantId);
    return body.tokens.accessToken;
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('invites a member and then removes them', async () => {
    const token = await ownerToken();
    const inv = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: `mem-${Math.random().toString(36).slice(2, 8)}@example.com`, name: 'Member', role: 'user' }),
    });
    expect(inv.status).toBe(201);
    const { user } = (await inv.json()) as { user: { id: string } };
    const del = await app.request(`/users/${user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(204);
  });

  it('refuses to remove the last owner', async () => {
    const token = await ownerToken();
    const list = await app.request('/users', { headers: { authorization: `Bearer ${token}` } });
    const { users: members } = (await list.json()) as { users: Array<{ id: string; role: string }> };
    const owner = members.find((m) => m.role === 'owner')!;
    const del = await app.request(`/users/${owner.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(del.status).toBe(400);
  });
});
