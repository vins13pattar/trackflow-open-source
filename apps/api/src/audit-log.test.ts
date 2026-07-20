import { eq, tenants } from '@trackflow/db';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('audit log: tenant actions are recorded and readable', () => {
  const app = createApp();
  const tenantIds: string[] = [];

  async function registerOwner(): Promise<{ token: string; tenantId: string }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `aud-${stamp}@example.com`, password: 'password123', name: 'Owner', tenantName: `Aud ${stamp}` }),
    });
    const body = (await res.json()) as { user: { tenantId: string }; tokens: { accessToken: string } };
    tenantIds.push(body.user.tenantId);
    return { token: body.tokens.accessToken, tenantId: body.user.tenantId };
  }

  afterAll(async () => {
    for (const id of tenantIds) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('records user.invited and user.removed, visible via /audit-logs', async () => {
    const { token } = await registerOwner();
    const stamp = Math.random().toString(36).slice(2, 8);
    const inv = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ email: `mem-${stamp}@example.com`, name: 'M', role: 'user' }),
    });
    expect(inv.status).toBe(201);
    const { user } = (await inv.json()) as { user: { id: string } };

    const del = await app.request(`/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
    });
    expect(del.status).toBe(204);

    const logs = (await (await app.request('/audit-logs', { headers: { authorization: `Bearer ${token}` } })).json()) as {
      logs: Array<{ action: string; target: string | null; targetId: string | null; actorIp: string | null; metadata: Record<string, unknown> }>;
    };
    const actions = logs.logs.map((l) => l.action);
    expect(actions).toContain('user.invited');
    expect(actions).toContain('user.removed');

    const invited = logs.logs.find((l) => l.action === 'user.invited')!;
    expect(invited.target).toBe('user');
    expect(invited.targetId).toBe(user.id);
    expect(invited.actorIp).toBe('203.0.113.7');
    expect(invited.metadata).toMatchObject({ email: `mem-${stamp}@example.com`, role: 'user' });
  });
});
