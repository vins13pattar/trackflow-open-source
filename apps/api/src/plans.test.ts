import { and, eq, planVersions, plans } from '@trackflow/db';
import { afterAll, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { getPlanCatalog, invalidatePlanCache, resolvePlanByKey, resolveTenantPlan } from './plan-service.js';

// Requires a running Postgres with the schema + seed applied. Gated so `pnpm
// test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('plan catalog (DB-backed, versioned)', () => {
  afterAll(() => invalidatePlanCache());

  it('exposes the seeded catalog with constant-matching prices + limits', async () => {
    invalidatePlanCache();
    const byKey = new Map((await getPlanCatalog()).map((p) => [p.key, p]));

    expect(byKey.get('free')).toMatchObject({ priceInr: 0, limits: { devices: 1, historyDays: 7 } });
    expect(byKey.get('starter')).toMatchObject({ priceInr: 299, annualInr: 2999, limits: { devices: 5, historyDays: 90 } });
    expect(byKey.get('professional')).toMatchObject({ priceInr: 999, limits: { devices: 25, apiCallsPerMonth: 100_000 } });
    expect(byKey.get('enterprise')?.limits.devices).toBe(-1);
    // Resolved versions are real DB rows, not the constant fallback.
    expect(byKey.get('starter')?.versionId).toBeTruthy();
  });

  it('resolves an unknown key to the free fallback', async () => {
    expect((await resolvePlanByKey('does-not-exist')).key).toBe('free');
  });

  it('grandfathers a pinned version when the plan price later changes', async () => {
    const [starter] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, 'starter'));
    const [v1] = await db
      .select({ id: planVersions.id })
      .from(planVersions)
      .where(and(eq(planVersions.planId, starter!.id), eq(planVersions.version, 1)));

    // Simulate an admin price bump: a new active version supersedes v1.
    const [v2] = await db
      .insert(planVersions)
      .values({
        planId: starter!.id,
        version: 2,
        priceInrMonthly: 499,
        priceInrAnnual: 4999,
        limits: { devices: 5, users: 3, geofences: 10, apiCallsPerMonth: 10_000, historyDays: 90 },
      })
      .returning({ id: planVersions.id });
    invalidatePlanCache();

    try {
      // New subscribers get the current (v2) price…
      expect((await resolvePlanByKey('starter')).priceInr).toBe(499);
      // …but a tenant pinned to v1 keeps the price it agreed to.
      const pinned = await resolveTenantPlan({ plan: 'starter', planVersionId: v1!.id });
      expect(pinned.priceInr).toBe(299);
      expect(pinned.versionId).toBe(v1!.id);
    } finally {
      await db.delete(planVersions).where(eq(planVersions.id, v2!.id));
      invalidatePlanCache();
    }
  });
});
