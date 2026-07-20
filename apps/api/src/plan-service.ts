import { asc, eq, type PlanVersionLimits, plans, planVersions } from '@trackflow/db';
import { PLANS, type PlanId } from '@trackflow/shared';
import { db } from './db.js';

/** A plan resolved to concrete price + limits (a specific version, or the
 *  built-in default when the DB catalog is empty). */
export interface ResolvedPlan {
  key: string;
  name: string;
  priceInr: number; // monthly
  annualInr: number;
  limits: PlanVersionLimits;
  includedUnits: Record<string, number>; // metered units bundled into the price
  versionId: string | null; // null = fell back to the built-in constant
  isPublic: boolean;
}

interface Cache {
  byKey: Map<string, ResolvedPlan>; // current active version per plan key
  byVersionId: Map<string, ResolvedPlan>; // any loaded version (versions are immutable)
  list: ResolvedPlan[]; // catalog, ordered by sort order
}

let cache: Cache | null = null;

function fromConstant(key: string): ResolvedPlan {
  const def = PLANS[key as PlanId] ?? PLANS.free;
  return { key: def.id, name: def.name, priceInr: def.priceInr, annualInr: def.annualInr, limits: def.limits, includedUnits: {}, versionId: null, isPublic: true };
}

async function load(): Promise<Cache> {
  const rows = await db
    .select({
      key: plans.key,
      name: plans.name,
      isPublic: plans.isPublic,
      active: plans.active,
      versionId: planVersions.id,
      version: planVersions.version,
      status: planVersions.status,
      monthly: planVersions.priceInrMonthly,
      annual: planVersions.priceInrAnnual,
      limits: planVersions.limits,
      includedUnits: planVersions.includedUnits,
    })
    .from(plans)
    .innerJoin(planVersions, eq(planVersions.planId, plans.id))
    .orderBy(asc(plans.sortOrder), asc(planVersions.version));

  const byKey = new Map<string, ResolvedPlan>();
  const byVersionId = new Map<string, ResolvedPlan>();
  const currentVersion = new Map<string, number>();

  for (const r of rows) {
    const resolved: ResolvedPlan = {
      key: r.key,
      name: r.name,
      priceInr: r.monthly,
      annualInr: r.annual,
      limits: r.limits,
      includedUnits: r.includedUnits,
      versionId: r.versionId,
      isPublic: r.isPublic,
    };
    byVersionId.set(r.versionId, resolved);
    // "Current" = the highest active version of an active plan.
    if (r.active && r.status === 'active' && r.version > (currentVersion.get(r.key) ?? -1)) {
      currentVersion.set(r.key, r.version);
      byKey.set(r.key, resolved);
    }
  }

  return { byKey, byVersionId, list: [...byKey.values()] };
}

async function ensure(): Promise<Cache> {
  if (!cache) cache = await load();
  return cache;
}

/** Drop the cache so the next resolve reloads from the DB (call after admin edits). */
export function invalidatePlanCache(): void {
  cache = null;
}

/** The full catalog (current active version of each plan), ordered. Falls back to
 *  the built-in defaults if the DB has no plans yet. */
export async function getPlanCatalog(): Promise<ResolvedPlan[]> {
  const c = await ensure();
  return c.list.length > 0 ? c.list : Object.values(PLANS).map((d) => fromConstant(d.id));
}

export async function resolvePlanByKey(key: string): Promise<ResolvedPlan> {
  const c = await ensure();
  return c.byKey.get(key) ?? fromConstant(key);
}

export async function resolvePlanByVersionId(id: string): Promise<ResolvedPlan | null> {
  const c = await ensure();
  return c.byVersionId.get(id) ?? null;
}

/** Resolves the plan a tenant is actually on: its pinned version (grandfathered)
 *  if set, else the plan key's current active version. */
export async function resolveTenantPlan(tenant: { plan?: string | null; planVersionId?: string | null }): Promise<ResolvedPlan> {
  if (tenant.planVersionId) {
    const pinned = await resolvePlanByVersionId(tenant.planVersionId);
    if (pinned) return pinned;
  }
  return resolvePlanByKey(tenant.plan ?? 'free');
}

/** Current active version id for a plan key (to pin a tenant when it subscribes). */
export async function currentVersionId(key: string): Promise<string | null> {
  return (await resolvePlanByKey(key)).versionId;
}
