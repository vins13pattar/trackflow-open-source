import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { desc, eq, tenants, webhookDeliveries, webhooks, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { systemDb as db } from './db.js';
import { env } from './env.js';
import { deliverEvent, deliverOne } from './webhook-service.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('webhooks: delivery log, edit, device filter', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  let receiver: Server;
  let receiverUrl: string;
  let receivedCount = 0;
  let receiverStatus = 200;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'WH', slug: `wh-${Math.random().toString(36).slice(2, 10)}` })
      .returning();
    tenantId = t!.id;
    const tokens = await issueTokens({ sub: 'user-test', tid: tenantId, role: 'owner' }, env.jwt);
    token = tokens.accessToken;

    // A tiny local HTTP server stands in for the webhook receiver.
    receiver = createServer((_req: IncomingMessage, res: ServerResponse) => {
      receivedCount += 1;
      res.statusCode = receiverStatus;
      res.end();
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const { port } = receiver.address() as AddressInfo;
    receiverUrl = `http://127.0.0.1:${port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => receiver.close(() => r()));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  async function createHook(body: { events: string[]; deviceIds?: string[] }) {
    const res = await app.request('/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `H-${Math.random().toString(36).slice(2, 8)}`, url: receiverUrl, ...body }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; deviceIds: string[]; events: string[] };
  }

  it('logs one row per attempt (success in attempt 1)', async () => {
    receiverStatus = 200;
    const hook = await createHook({ events: ['alert.triggered'] });
    const [row] = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhooks).where(eq(webhooks.id, hook.id)));
    const outcome = await deliverOne(row!, 'alert.triggered', { hello: 'world' });
    expect(outcome).toMatchObject({ ok: true, attempts: 1 });

    const log = await withSystem(db, 'test-fixture', (tx) =>
      tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)).orderBy(desc(webhookDeliveries.createdAt)),
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: 'sent', httpStatus: 200, attempt: 1 });
  });

  it('records every retry on failure and reports HTTP status', async () => {
    receiverStatus = 500;
    const hook = await createHook({ events: ['alert.triggered'] });
    const [row] = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhooks).where(eq(webhooks.id, hook.id)));
    const outcome = await deliverOne(row!, 'alert.triggered', {});
    expect(outcome).toMatchObject({ ok: false, attempts: 3, status: 500 });
    const log = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)));
    expect(log).toHaveLength(3);
    expect(log.every((r) => r.status === 'failed' && r.httpStatus === 500)).toBe(true);
  });

  it('PATCH /webhooks/:id updates editable fields', async () => {
    const hook = await createHook({ events: ['alert.triggered'] });
    const newEvents = ['alert.triggered', 'device.offline'];
    const res = await app.request(`/webhooks/${hook.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: newEvents, status: 'paused' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: string[]; status: string };
    expect(body.events).toEqual(newEvents);
    expect(body.status).toBe('paused');
  });

  it('GET /webhooks/:id/deliveries returns the per-attempt log (filterable)', async () => {
    receiverStatus = 500;
    const hook = await createHook({ events: ['alert.triggered'] });
    const [row] = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhooks).where(eq(webhooks.id, hook.id)));
    await deliverOne(row!, 'alert.triggered', {});
    const res = await app.request(`/webhooks/${hook.id}/deliveries?status=failed`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deliveries: Array<{ status: string }>; total: number };
    expect(body.total).toBe(3);
    expect(body.deliveries.every((d) => d.status === 'failed')).toBe(true);
  });

  it('honours the per-device allow-list: filtered devices do not fire the hook', async () => {
    receiverStatus = 200;
    // Clean out hooks from earlier tests in this file so we measure only the
    // filter-under-test (every prior hook in this tenant also subscribed to
    // alert.triggered and would otherwise inflate receivedCount).
    await withSystem(db, 'test-fixture', (tx) => tx.delete(webhooks).where(eq(webhooks.tenantId, tenantId)));
    const allowedDevice = '00000000-0000-0000-0000-000000000001';
    const otherDevice = '00000000-0000-0000-0000-000000000002';
    const hook = await createHook({ events: ['alert.triggered'], deviceIds: [allowedDevice] });

    receivedCount = 0;
    await deliverEvent(tenantId, 'alert.triggered', { deviceId: otherDevice });
    expect(receivedCount).toBe(0); // filtered out
    const logA = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)));
    expect(logA).toHaveLength(0);

    await deliverEvent(tenantId, 'alert.triggered', { deviceId: allowedDevice });
    expect(receivedCount).toBe(1); // allowed -> fired
    const logB = await withSystem(db, 'test-fixture', (tx) => tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id)));
    expect(logB).toHaveLength(1);
    expect(logB[0]?.status).toBe('sent');
  });
});
