import { billingRates, eq, plans } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { getBilledRate, invalidateRatesCache } from './billing-rates-service.js';
import { db } from './db.js';
import { invalidatePlanCache, resolvePlanByKey } from './plan-service.js';

// Requires a running Postgres with the schema + seed applied. Gated so `pnpm
// test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

const TOKEN = 'test-admin-token';
const LIMITS = { devices: 10, users: 5, geofences: 20, apiCallsPerMonth: 50_000, historyDays: 180 };

describe.skipIf(!enabled)('admin plan/rate management', () => {
  const app = createApp();
  const createdKeys: string[] = [];
  const createdRates: string[] = [];
  const key = () => {
    const k = `adm-${Math.random().toString(36).slice(2, 8)}`;
    createdKeys.push(k);
    return k;
  };
  const req = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(() => {
    process.env.ADMIN_API_TOKEN = TOKEN;
  });

  afterAll(async () => {
    for (const k of createdKeys) await db.delete(plans).where(eq(plans.key, k));
    for (const r of createdRates) await db.delete(billingRates).where(eq(billingRates.resource, r));
    invalidatePlanCache();
    invalidateRatesCache();
    delete process.env.ADMIN_API_TOKEN;
  });

  it('rejects requests without a valid admin token', async () => {
    expect((await app.request('/admin/plans')).status).toBe(401);
    expect((await app.request('/admin/plans', { headers: { 'x-admin-token': 'wrong' } })).status).toBe(401);
  });

  it('creates a plan and lists it', async () => {
    const k = key();
    const res = await req('POST', '/admin/plans', { key: k, name: 'Adm', priceInrMonthly: 500, priceInrAnnual: 5000, limits: LIMITS, includedUnits: { sms: 200 } });
    expect(res.status).toBe(201);
    const { plans: list } = (await (await req('GET', '/admin/plans')).json()) as { plans: Array<{ key: string }> };
    expect(list.some((p) => p.key === k)).toBe(true);
  });

  it('versions a plan on edit, archiving the old version (grandfathering)', async () => {
    const k = key();
    await req('POST', '/admin/plans', { key: k, name: 'Ver', priceInrMonthly: 300, priceInrAnnual: 3000, limits: LIMITS, includedUnits: {} });
    const edit = await req('PUT', `/admin/plans/${k}/version`, { priceInrMonthly: 600, priceInrAnnual: 6000, limits: LIMITS, includedUnits: {} });
    expect(edit.status).toBe(201);

    expect((await resolvePlanByKey(k)).priceInr).toBe(600); // new subscribers get the new price
    const { plans: cat } = (await (await req('GET', '/admin/plans')).json()) as {
      plans: Array<{ key: string; versions: Array<{ version: number; status: string }> }>;
    };
    const versions = cat.find((p) => p.key === k)!.versions;
    expect(versions.find((v) => v.version === 1)!.status).toBe('archived');
    expect(versions.find((v) => v.version === 2)!.status).toBe('active');
  });

  it('upserts a metered rate (cost × markup)', async () => {
    const resource = `tr-${Math.random().toString(36).slice(2, 8)}`;
    createdRates.push(resource);
    const res = await req('PUT', `/admin/rates/${resource}`, { unitCostInr: 0.3, markup: 3 });
    expect(res.status).toBe(200);
    expect((await getBilledRate(resource))?.ratePerUnitInr).toBeCloseTo(0.9);
  });

  it('flags a plan priced below its included-unit cost', async () => {
    const k = key();
    // 100 included SMS × ₹0.20 seeded cost = ₹20 > the ₹10 price → loss.
    await req('POST', '/admin/plans', { key: k, name: 'Loss', priceInrMonthly: 10, priceInrAnnual: 100, limits: LIMITS, includedUnits: { sms: 100 } });
    const { plans: report } = (await (await req('GET', '/admin/margin-check')).json()) as {
      plans: Array<{ key: string; flagged: boolean }>;
    };
    expect(report.find((p) => p.key === k)?.flagged).toBe(true);
  });
});
