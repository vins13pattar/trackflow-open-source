import { alertDeliveries, alerts, desc, devices, eq, tenants, withSystem } from '@trackflow/db';
import type { DeliveryResult } from '@trackflow/notifications';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { recordDeliveries } from './delivery-log.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('delivery log recording', () => {
  let tenantId: string;
  let alertId: string;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Log', slug: `log-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
    await withSystem(db, async (tx) => {
      const [d] = await tx.insert(devices).values({ tenantId, name: 'Dev', imei: `imei-${Math.random().toString(36).slice(2, 12)}` }).returning();
      const [a] = await tx.insert(alerts).values({ tenantId, deviceId: d!.id, type: 'geofence.enter', severity: 'warning', title: 'T', message: 'B' }).returning();
      alertId = a!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('schedules a retry only for transient failures on retryable channels', async () => {
    const results: DeliveryResult[] = [
      { channel: 'email', recipient: 'a@x.com', status: 'sent', sentAt: Date.now() },
      { channel: 'sms', recipient: '+91999', status: 'failed', error: 'provider 500', sentAt: Date.now() },
      { channel: 'console', recipient: '-', status: 'failed', error: 'x', sentAt: Date.now() }, // not retryable
      { channel: 'email', recipient: 'suppressed', status: 'skipped', error: 'quiet-hours', sentAt: Date.now() },
    ];
    await recordDeliveries(tenantId, alertId, 'Subject', 'Body', results);

    const rows = await withSystem(db, (tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.alertId, alertId)).orderBy(desc(alertDeliveries.createdAt)),
    );
    expect(rows).toHaveLength(4);
    const byKey = (ch: string, st: string) => rows.find((r) => r.channel === ch && r.status === st)!;

    expect(byKey('sms', 'failed').nextRetryAt).not.toBeNull(); // retryable transient failure
    expect(byKey('email', 'sent').nextRetryAt).toBeNull();
    expect(byKey('console', 'failed').nextRetryAt).toBeNull(); // console isn't retryable
    expect(byKey('email', 'skipped').nextRetryAt).toBeNull();
  });
});
