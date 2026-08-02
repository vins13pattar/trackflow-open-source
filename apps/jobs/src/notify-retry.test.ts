import { alertDeliveries, alerts, devices, eq, tenants, withSystem } from '@trackflow/db';
import type { Channel, ChannelName } from '@trackflow/notifications';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { retryDueDeliveries } from './notify-retry.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

/** Registry whose every channel reports a fixed status, for deterministic retries. */
function stubRegistry(status: 'sent' | 'failed'): Record<ChannelName, Channel> {
  const ch = (name: ChannelName): Channel => ({
    name,
    send: async (_m, r) =>
      (r.emails ?? r.phones ?? r.pushTokens ?? ['x']).map((rec) => ({
        channel: name,
        recipient: rec,
        status,
        error: status === 'failed' ? 'stub fail' : undefined,
        sentAt: Date.now(),
      })),
  });
  return { console: ch('console'), email: ch('email'), sms: ch('sms'), webhook: ch('webhook'), push: ch('push'), whatsapp: ch('whatsapp') };
}

describe.skipIf(!enabled)('notify-retry job', () => {
  let tenantId: string;
  let deviceId: string;
  let alertId: string;
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60 * 60_000);

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Retry', slug: `retry-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
    await withSystem(db, 'test-fixture', async (tx) => {
      const [d] = await tx.insert(devices).values({ tenantId, name: 'Dev', imei: `imei-${Math.random().toString(36).slice(2, 12)}` }).returning();
      deviceId = d!.id;
      const [a] = await tx
        .insert(alerts)
        .values({ tenantId, deviceId, type: 'geofence.enter', severity: 'warning', title: 'T', message: 'B' })
        .returning();
      alertId = a!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  async function seed(values: { attempt: number; nextRetryAt: Date | null; status?: string }): Promise<string> {
    const [row] = await withSystem(db, 'test-fixture', (tx) =>
      tx
        .insert(alertDeliveries)
        .values({
          tenantId,
          alertId,
          channel: 'email',
          recipient: 'user@example.com',
          subject: 'S',
          body: 'B',
          status: values.status ?? 'failed',
          attempt: values.attempt,
          error: 'first failure',
          nextRetryAt: values.nextRetryAt,
        })
        .returning({ id: alertDeliveries.id }),
    );
    return row!.id;
  }
  const get = async (id: string) => (await withSystem(db, 'test-fixture', (tx) => tx.select().from(alertDeliveries).where(eq(alertDeliveries.id, id))))[0]!;

  it('marks a due delivery sent when the retry succeeds', async () => {
    const id = await seed({ attempt: 1, nextRetryAt: past });
    const res = await retryDueDeliveries(new Date(), stubRegistry('sent'));
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const row = await get(id);
    expect(row.status).toBe('sent');
    expect(row.attempt).toBe(2);
    expect(row.nextRetryAt).toBeNull();
  });

  it('requeues with a later nextRetryAt when the retry fails again (under the cap)', async () => {
    const id = await seed({ attempt: 1, nextRetryAt: past });
    await retryDueDeliveries(new Date(), stubRegistry('failed'));
    const row = await get(id);
    expect(row.status).toBe('failed');
    expect(row.attempt).toBe(2);
    expect(row.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('abandons after the attempt cap (default 5)', async () => {
    const id = await seed({ attempt: 4, nextRetryAt: past });
    await retryDueDeliveries(new Date(), stubRegistry('failed'));
    const row = await get(id);
    expect(row.status).toBe('abandoned');
    expect(row.attempt).toBe(5);
    expect(row.nextRetryAt).toBeNull();
  });

  it('leaves not-yet-due deliveries untouched', async () => {
    const id = await seed({ attempt: 1, nextRetryAt: future });
    await retryDueDeliveries(new Date(), stubRegistry('sent'));
    const row = await get(id);
    expect(row.status).toBe('failed');
    expect(row.attempt).toBe(1);
  });
});
