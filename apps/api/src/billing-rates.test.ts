import { eq, planVersions, plans, tenants, usageCounters, withSystem } from '@trackflow/db';
import { describe, expect, it } from 'vitest';
import { getBilledRate, invalidateRatesCache } from './billing-rates-service.js';
import { computeOverages, invoiceOverages } from './billing-service.js';
import { systemDb as db } from './db.js';
import { invalidatePlanCache } from './plan-service.js';
import { currentPeriod } from './usage-service.js';

// Requires a running Postgres with the schema + seed applied. Gated so `pnpm
// test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('billing rates + metered overages', () => {
  // Spins up a throwaway plan/version (with included SMS) + tenant + usage row,
  // isolated from the seeded catalog. Returns the tenant id and a cleanup fn.
  async function setup(includedSms: number, smsUsed: number) {
    const stamp = Math.random().toString(36).slice(2, 10);
    const [plan] = await db.insert(plans).values({ key: `t-${stamp}`, name: 'Test', sortOrder: 99, isPublic: false }).returning();
    const [ver] = await db
      .insert(planVersions)
      .values({
        planId: plan!.id,
        version: 1,
        priceInrMonthly: 0,
        limits: { devices: 5, users: 3, geofences: 10, apiCallsPerMonth: 10_000, historyDays: 90 },
        includedUnits: { sms: includedSms },
      })
      .returning();
    const [tenant] = await db
      .insert(tenants)
      .values({ name: 'Over', slug: `over-${stamp}`, plan: plan!.key, planVersionId: ver!.id })
      .returning();
    invalidatePlanCache();
    await withSystem(db, 'test-fixture', (tx) => tx.insert(usageCounters).values({ tenantId: tenant!.id, period: currentPeriod(), smsSent: smsUsed }));
    return {
      tenantId: tenant!.id,
      cleanup: async () => {
        await db.delete(tenants).where(eq(tenants.id, tenant!.id));
        await db.delete(plans).where(eq(plans.id, plan!.id));
        invalidatePlanCache();
      },
    };
  }

  it('derives the billed rate as unit cost × markup', async () => {
    invalidateRatesCache();
    const sms = await getBilledRate('sms');
    expect(sms?.markup).toBe(2.5);
    expect(sms!.ratePerUnitInr).toBeCloseTo(0.5); // 0.20 × 2.5
  });

  it('bills overage = (used − included) × rate, soft-capped', async () => {
    const { tenantId, cleanup } = await setup(100, 150);
    try {
      const { items, totalInr } = await computeOverages(tenantId);
      const sms = items.find((i) => i.resource === 'sms')!;
      expect(sms).toMatchObject({ included: 100, used: 150, overage: 50 });
      expect(sms.amountInr).toBeCloseTo(25); // 50 × 0.5
      expect(totalInr).toBeCloseTo(25);
      expect(items.find((i) => i.resource === 'whatsapp')!.overage).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('charges nothing while usage stays within the included quota', async () => {
    const { tenantId, cleanup } = await setup(100, 50);
    try {
      const { items, totalInr } = await computeOverages(tenantId);
      expect(items.find((i) => i.resource === 'sms')!.overage).toBe(0);
      expect(totalInr).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('bills overage as a due invoice with GST, idempotently', async () => {
    const { tenantId, cleanup } = await setup(100, 150);
    try {
      const inv = await invoiceOverages(tenantId, currentPeriod());
      expect(inv).not.toBeNull();
      expect(inv!.status).toBe('due');
      expect(inv!.subtotalInr).toBe(25); // 50 × ₹0.50
      expect(inv!.totalInr).toBe(30); // + 18% GST (₹5)
      expect(inv!.lineItems).toHaveLength(1);
      // Re-running returns the same invoice — no duplicate billing.
      const again = await invoiceOverages(tenantId, currentPeriod());
      expect(again!.id).toBe(inv!.id);
    } finally {
      await cleanup();
    }
  });

  it('bills nothing when there is no overage', async () => {
    const { tenantId, cleanup } = await setup(100, 50);
    try {
      expect(await invoiceOverages(tenantId, currentPeriod())).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
