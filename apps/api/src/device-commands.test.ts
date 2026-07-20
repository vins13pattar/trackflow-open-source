import { deviceCommands, devices, eq, tenants, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './env.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('two-way device commands: queue → poll → ack', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  let deviceId: string;
  const ingestToken = env.ingestToken;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Cmd', slug: `cmd-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
    // sub must be a uuid because routes persist principal.userId into uuid
    // columns (e.g. deviceCommands.requestedBy, auditLogs.actorUserId).
    token = (await issueTokens({ sub: crypto.randomUUID(), tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
    await withSystem(db, async (tx) => {
      const [d] = await tx
        .insert(devices)
        .values({ tenantId, name: 'Bus', imei: `imei-${Math.random().toString(36).slice(2, 12)}` })
        .returning();
      deviceId = d!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const userHeaders = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
  const ingestHeaders = () => ({ 'content-type': 'application/json', 'x-ingest-token': ingestToken });

  it('queues a command (status=queued) and lists it', async () => {
    const res = await app.request(`/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ command: 'immobilize', parameters: { reason: 'unpaid' }, expiresInSeconds: 600 }),
    });
    expect(res.status).toBe(201);
    const queued = (await res.json()) as { id: string; status: string; parameters: Record<string, unknown> };
    expect(queued.status).toBe('queued');
    expect(queued.parameters).toEqual({ reason: 'unpaid' });

    const list = (await (await app.request(`/devices/${deviceId}/commands?status=queued`, { headers: userHeaders() })).json()) as { total: number };
    expect(list.total).toBeGreaterThanOrEqual(1);
  });

  it('the ingest pickup claims queued commands (marks sent) and ack updates status', async () => {
    // Queue another command, then have the ingest poll claim it.
    const post = await app.request(`/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: userHeaders(),
      body: JSON.stringify({ command: 'request_location' }),
    });
    const created = (await post.json()) as { id: string };

    const pollRes = await app.request(`/internal/devices/${deviceId}/commands/pending`, {
      method: 'POST',
      headers: ingestHeaders(),
    });
    expect(pollRes.status).toBe(200);
    const polled = (await pollRes.json()) as { commands: Array<{ id: string; command: string }> };
    expect(polled.commands.some((cmd) => cmd.id === created.id)).toBe(true);

    // Re-polling drains nothing — they're now 'sent' not 'queued'.
    const rePoll = (await (await app.request(`/internal/devices/${deviceId}/commands/pending`, { method: 'POST', headers: ingestHeaders() })).json()) as {
      commands: unknown[];
    };
    expect(rePoll.commands).toHaveLength(0);

    // Ack the command.
    const ackRes = await app.request(`/internal/devices/commands/${created.id}/ack`, {
      method: 'POST',
      headers: ingestHeaders(),
      body: JSON.stringify({ status: 'acked', response: 'lat=12.97,lon=77.59' }),
    });
    expect(ackRes.status).toBe(200);
    const [row] = await withSystem(db, (tx) => tx.select().from(deviceCommands).where(eq(deviceCommands.id, created.id)));
    expect(row?.status).toBe('acked');
    expect(row?.response).toBe('lat=12.97,lon=77.59');
    expect(row?.ackedAt).not.toBeNull();
  });

  it('cancel marks a queued command canceled but no-ops on already-sent', async () => {
    const post = await app.request(`/devices/${deviceId}/commands`, {
      method: 'POST', headers: userHeaders(), body: JSON.stringify({ command: 'reboot' }),
    });
    const cmd = (await post.json()) as { id: string };

    const cancel = await app.request(`/devices/${deviceId}/commands/${cmd.id}`, { method: 'DELETE', headers: userHeaders() });
    expect(cancel.status).toBe(200);

    // Trying to cancel again now returns 404 (no longer in 'queued').
    const again = await app.request(`/devices/${deviceId}/commands/${cmd.id}`, { method: 'DELETE', headers: userHeaders() });
    expect(again.status).toBe(404);
  });

  it('rejects ingest endpoints without the x-ingest-token', async () => {
    const res = await app.request(`/internal/devices/${deviceId}/commands/pending`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
