import { eq, orgMemberships, tenants } from '@trackflow/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('multi-org memberships + org switching', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  async function registerOwner(): Promise<{ token: string; userId: string; tenantId: string }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `me-${stamp}@example.com`, password: 'password123', name: 'Me', tenantName: `Me ${stamp}` }),
    });
    const body = (await res.json()) as { user: { id: string; tenantId: string }; tokens: { accessToken: string } };
    tenantIds.push(body.user.tenantId);
    return { token: body.tokens.accessToken, userId: body.user.id, tenantId: body.user.tenantId };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it("register auto-creates a membership; /me/memberships lists the owner's org", async () => {
    const { token, tenantId } = await registerOwner();
    const res = await app.request('/me/memberships', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      memberships: Array<{ tenantId: string; role: string; tenantName: string }>;
      activeTenantId: string;
      total: number;
    };
    expect(body.activeTenantId).toBe(tenantId);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.memberships.some((m) => m.tenantId === tenantId && m.role === 'owner')).toBe(true);
  });

  it('switching to an org the user belongs to mints fresh tokens with that role', async () => {
    const { token, userId, tenantId: original } = await registerOwner();

    // Stand up a second tenant + manually add the user as a member with role 'admin'.
    const [secondTenant] = await db
      .insert(tenants)
      .values({ name: 'Other', slug: `other-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    tenantIds.push(secondTenant!.id);
    await db.insert(orgMemberships).values({ userId, tenantId: secondTenant!.id, role: 'admin' });

    const sw = await app.request('/me/switch-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantId: secondTenant!.id }),
    });
    expect(sw.status).toBe(200);
    const body = (await sw.json()) as { tenantId: string; role: string; tokens: { accessToken: string } };
    expect(body.tenantId).toBe(secondTenant!.id);
    expect(body.role).toBe('admin');

    // The new token sees the second tenant — confirm by listing again from it.
    const list = (await (await app.request('/me/memberships', { headers: { authorization: `Bearer ${body.tokens.accessToken}` } })).json()) as {
      activeTenantId: string;
    };
    expect(list.activeTenantId).toBe(secondTenant!.id);
    expect(original).not.toBe(secondTenant!.id);
  });

  it("refuses to switch into a tenant the user isn't a member of", async () => {
    const { token } = await registerOwner();
    const [stranger] = await db
      .insert(tenants)
      .values({ name: 'Not yours', slug: `nope-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    tenantIds.push(stranger!.id);

    const sw = await app.request('/me/switch-org', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantId: stranger!.id }),
    });
    expect(sw.status).toBe(403);
  });
});

describe.skipIf(!enabled)('account: password change + session management', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  async function registerOwner(password = 'password123'): Promise<{ token: string; refresh: string; email: string; userId: string; tenantId: string }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `pw-${stamp}@example.com`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Me', tenantName: `Me ${stamp}` }),
    });
    const body = (await res.json()) as {
      user: { id: string; tenantId: string };
      tokens: { accessToken: string; refreshToken: string };
    };
    tenantIds.push(body.user.tenantId);
    return { token: body.tokens.accessToken, refresh: body.tokens.refreshToken, email, userId: body.user.id, tenantId: body.user.tenantId };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('rejects a password change with a wrong current password', async () => {
    const { token } = await registerOwner();
    const res = await app.request('/me/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'newpassword456' }),
    });
    expect(res.status).toBe(401);
  });

  it('changes the password and revokes refresh sessions', async () => {
    const { token, refresh, email } = await registerOwner();
    const change = await app.request('/me/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'password123', newPassword: 'newpassword456' }),
    });
    expect(change.status).toBe(200);

    // The old refresh token must be revoked.
    const refused = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    expect(refused.status).toBe(401);

    // Login with the new password works.
    const login = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'newpassword456' }),
    });
    expect(login.status).toBe(200);

    // …and the old password no longer does.
    const denied = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(denied.status).toBe(401);
  });

  it('lists active sessions and lets the user revoke them all', async () => {
    const { token, refresh } = await registerOwner();
    const list = await app.request('/me/sessions', { headers: { authorization: `Bearer ${token}` } });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { sessions: Array<{ revokedAt: string | null }>; total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.sessions.some((s) => s.revokedAt === null)).toBe(true);

    const revoke = await app.request('/me/sessions/revoke-all', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoke.status).toBe(200);

    const refused = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    expect(refused.status).toBe(401);
  });
});
