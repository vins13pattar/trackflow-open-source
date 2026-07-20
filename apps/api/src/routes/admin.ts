import { and, asc, billingRates, eq, planVersions, plans, sql } from '@trackflow/db';
import { errors } from '@trackflow/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { invalidateRatesCache, listRates } from '../billing-rates-service.js';
import { closePeriodOverages } from '../billing-service.js';
import { db } from '../db.js';
import { requireAdmin } from '../middleware/admin.js';
import { getPlanCatalog, invalidatePlanCache } from '../plan-service.js';

/** Platform-operator API for managing the plan catalog + metered rates. Gated by
 *  the admin token; edits create new plan versions so existing subscribers stay
 *  grandfathered, and bust the plan/rate caches. */
export const adminRoutes = new Hono();

adminRoutes.use('*', requireAdmin);

const limitsSchema = z.object({
  devices: z.number().int(),
  users: z.number().int(),
  geofences: z.number().int(),
  apiCallsPerMonth: z.number().int(),
  historyDays: z.number().int(),
});
const includedUnitsSchema = z.record(z.string(), z.number().nonnegative()).optional();
const versionFields = {
  priceInrMonthly: z.number().int().nonnegative(),
  priceInrAnnual: z.number().int().nonnegative(),
  limits: limitsSchema,
  includedUnits: includedUnitsSchema,
};
const createPlanSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers and dashes only'),
  name: z.string().min(1).max(80),
  description: z.string().max(400).optional(),
  sortOrder: z.number().int().optional(),
  isPublic: z.boolean().optional(),
  ...versionFields,
});
const versionSchema = z.object(versionFields);
const patchPlanSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  isPublic: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
const rateSchema = z.object({ unitCostInr: z.number().nonnegative(), markup: z.number().positive(), active: z.boolean().optional() });

// Full catalog (every plan with all its versions, newest first) for the admin UI.
adminRoutes.get('/plans', async (c) => {
  const planRows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.key));
  const versionRows = await db.select().from(planVersions).orderBy(asc(planVersions.planId), asc(planVersions.version));
  const byPlan = new Map<string, typeof versionRows>();
  for (const v of versionRows) {
    const list = byPlan.get(v.planId) ?? [];
    list.push(v);
    byPlan.set(v.planId, list);
  }
  return c.json({ plans: planRows.map((p) => ({ ...p, versions: byPlan.get(p.id) ?? [] })) });
});

adminRoutes.post('/plans', async (c) => {
  const b = createPlanSchema.parse(await c.req.json());
  try {
    const [plan] = await db
      .insert(plans)
      .values({ key: b.key, name: b.name, description: b.description, sortOrder: b.sortOrder ?? 0, isPublic: b.isPublic ?? true })
      .returning();
    const [version] = await db
      .insert(planVersions)
      .values({ planId: plan!.id, version: 1, priceInrMonthly: b.priceInrMonthly, priceInrAnnual: b.priceInrAnnual, limits: b.limits, includedUnits: b.includedUnits ?? {} })
      .returning();
    invalidatePlanCache();
    return c.json({ plan, version }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw errors.duplicate('Plan key already exists');
    throw err;
  }
});

// Edit a plan's price/limits → archive the current active version and add a new
// one. Subscribers pinned to the old version keep their price (grandfathering).
adminRoutes.put('/plans/:key/version', async (c) => {
  const b = versionSchema.parse(await c.req.json());
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, c.req.param('key')));
  if (!plan) throw errors.notFound('Plan not found');

  const [maxRow] = await db
    .select({ maxV: sql<number>`coalesce(max(${planVersions.version}), 0)` })
    .from(planVersions)
    .where(eq(planVersions.planId, plan.id));
  await db.update(planVersions).set({ status: 'archived' }).where(and(eq(planVersions.planId, plan.id), eq(planVersions.status, 'active')));
  const [version] = await db
    .insert(planVersions)
    .values({ planId: plan.id, version: Number(maxRow?.maxV ?? 0) + 1, priceInrMonthly: b.priceInrMonthly, priceInrAnnual: b.priceInrAnnual, limits: b.limits, includedUnits: b.includedUnits ?? {} })
    .returning();
  invalidatePlanCache();
  return c.json({ version }, 201);
});

// Non-versioned metadata (name/visibility/order/active).
adminRoutes.patch('/plans/:key', async (c) => {
  const b = patchPlanSchema.parse(await c.req.json());
  if (Object.keys(b).length === 0) throw errors.validation('No fields to update');
  const [plan] = await db.update(plans).set(b).where(eq(plans.key, c.req.param('key'))).returning();
  if (!plan) throw errors.notFound('Plan not found');
  invalidatePlanCache();
  return c.json({ plan });
});

adminRoutes.get('/rates', async (c) => {
  const rates = await db.select().from(billingRates).orderBy(asc(billingRates.resource));
  return c.json({ rates });
});

adminRoutes.put('/rates/:resource', async (c) => {
  const b = rateSchema.parse(await c.req.json());
  const resource = c.req.param('resource');
  const [rate] = await db
    .insert(billingRates)
    .values({ resource, unitCostInr: b.unitCostInr, markup: b.markup, active: b.active ?? true })
    .onConflictDoUpdate({ target: billingRates.resource, set: { unitCostInr: b.unitCostInr, markup: b.markup, active: b.active ?? true, updatedAt: sql`now()` } })
    .returning();
  invalidateRatesCache();
  return c.json({ rate });
});

// Close a billing period: bill every tenant's metered overages for 'YYYY-MM'
// as due invoices (idempotent). Operator/cron triggered.
adminRoutes.post('/billing/close/:period', async (c) => {
  const period = c.req.param('period');
  if (!/^\d{4}-\d{2}$/.test(period)) throw errors.validation('period must be YYYY-MM');
  return c.json(await closePeriodOverages(period));
});

// Margin guardrail: flag any plan whose monthly price doesn't cover the operator
// cost of the units bundled into it.
adminRoutes.get('/margin-check', async (c) => {
  const [catalog, rates] = await Promise.all([getPlanCatalog(), listRates()]);
  const cost = new Map(rates.map((r) => [r.resource, r.unitCostInr]));
  const report = catalog.map((p) => {
    const includedCostInr = Object.entries(p.includedUnits).reduce((s, [res, qty]) => s + qty * (cost.get(res) ?? 0), 0);
    const marginInr = p.priceInr - includedCostInr;
    return {
      key: p.key,
      priceInrMonthly: p.priceInr,
      includedCostInr: Math.round(includedCostInr * 100) / 100,
      marginInr: Math.round(marginInr * 100) / 100,
      flagged: marginInr < 0,
    };
  });
  return c.json({ plans: report });
});
