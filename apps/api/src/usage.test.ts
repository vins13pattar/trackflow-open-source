import { and, eq, tenants, usageCounters, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb as db } from './db.js';
import { currentPeriod, getUsage, meterApiCall, meterSms } from './usage-service.js';

// Requires a running Postgres with RLS applied. Gated so `pnpm test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('usage metering', () => {
  let tenantId: string;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Meter Co', slug: `meter-${Date.now()}`, plan: 'free' })
      .returning();
    tenantId = t!.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, 'test-fixture', (tx) => tx.delete(usageCounters).where(eq(usageCounters.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it('counts API calls and SMS for the current period', async () => {
    expect(await getUsage(tenantId)).toEqual({ apiCalls: 0, smsSent: 0, whatsappSent: 0, emailSent: 0 });
    await meterApiCall(tenantId);
    await meterApiCall(tenantId);
    await meterSms(tenantId, 3);
    expect(await getUsage(tenantId)).toEqual({ apiCalls: 2, smsSent: 3, whatsappSent: 0, emailSent: 0 });
  });

  it('enforces the monthly API quota (free plan = 500)', async () => {
    await withSystem(db, 'test-fixture', (tx) =>
      tx
        .update(usageCounters)
        .set({ apiCalls: 500 })
        .where(and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.period, currentPeriod()))),
    );
    await expect(meterApiCall(tenantId)).rejects.toThrow(/quota/i);
  });
});
