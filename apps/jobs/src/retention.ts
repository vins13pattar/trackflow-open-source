/**
 * Retention + partition maintenance (cross-tenant system job). Runnable on demand
 * (`pnpm jobs:retention`) or on a schedule. Each run:
 *   1. provisions upcoming monthly partitions (so ingest never hits a missing range),
 *   2. deletes positions older than each tenant's plan history window
 *      (plans.historyDays: free 7 / starter 90 / professional 365 / enterprise ∞),
 *   3. drops monthly partitions entirely older than the most generous active plan
 *      — skipped while any unlimited-retention tenant exists, since one shared
 *      partition holds every tenant's rows.
 */
import { pathToFileURL } from 'node:url';
import { and, eq, lt, planVersions, plans, positions, sql, tenants, withSystem } from '@trackflow/db';
import { PLANS, type PlanId } from '@trackflow/shared';
import { db } from './db.js';

const MONTHS_AHEAD = Number(process.env.RETENTION_MONTHS_AHEAD ?? 3);
const GRACE_DAYS = Number(process.env.RETENTION_GRACE_DAYS ?? 0);
const DAY_MS = 86_400_000;

const withGrace = (days: number): number => (days < 0 ? -1 : days + GRACE_DAYS);

/** Builds history-day lookups from the DB plan catalog so retention follows
 *  admin-configured limits: by plan-version id (for pinned tenants) and the
 *  current active version per plan key. */
async function loadHistoryWindows(): Promise<{ byVersionId: Map<string, number>; currentByKey: Map<string, number> }> {
  const rows = await withSystem(db, 'system-job', (tx) =>
    tx
      .select({ key: plans.key, active: plans.active, versionId: planVersions.id, version: planVersions.version, status: planVersions.status, limits: planVersions.limits })
      .from(plans)
      .innerJoin(planVersions, eq(planVersions.planId, plans.id)),
  );
  const byVersionId = new Map<string, number>();
  const currentByKey = new Map<string, number>();
  const currentVer = new Map<string, number>();
  for (const r of rows) {
    byVersionId.set(r.versionId, r.limits.historyDays);
    if (r.active && r.status === 'active' && r.version > (currentVer.get(r.key) ?? -1)) {
      currentVer.set(r.key, r.version);
      currentByKey.set(r.key, r.limits.historyDays);
    }
  }
  return { byVersionId, currentByKey };
}

export async function runRetention(): Promise<void> {
  // 1) Keep a forward window of monthly partitions (and the default catch-all).
  await withSystem(db, 'system-job', (tx) =>
    tx.execute(sql`select trackflow_provision_positions_partitions(1, ${MONTHS_AHEAD})`),
  );

  // 2) Per-tenant row retention, using the DB-resolved history window.
  const { byVersionId, currentByKey } = await loadHistoryWindows();
  const historyDaysFor = (t: { plan: string; planVersionId: string | null }): number => {
    const raw =
      (t.planVersionId ? byVersionId.get(t.planVersionId) : undefined) ??
      currentByKey.get(t.plan) ??
      PLANS[t.plan as PlanId]?.limits.historyDays ??
      PLANS.free.limits.historyDays;
    return withGrace(raw);
  };

  const rows = await withSystem(db, 'system-job', (tx) =>
    tx.select({ id: tenants.id, name: tenants.name, plan: tenants.plan, planVersionId: tenants.planVersionId }).from(tenants),
  );

  let anyUnlimited = false;
  let maxFiniteDays = 0;
  for (const t of rows) {
    const days = historyDaysFor(t);
    if (days < 0) {
      anyUnlimited = true;
      continue;
    }
    maxFiniteDays = Math.max(maxFiniteDays, days);
    const cutoff = new Date(Date.now() - days * DAY_MS);
    await withSystem(db, 'system-job', (tx) =>
      tx.delete(positions).where(and(eq(positions.tenantId, t.id), lt(positions.fixTime, cutoff))),
    );
    console.log(`[retention] ${t.name} (${t.plan}): purged positions before ${cutoff.toISOString().slice(0, 10)}`);
  }

  // 3) Drop fully-expired partitions. A month partition holds every tenant's rows,
  //    so it can only go once it predates the most generous active retention — and
  //    never while an unlimited-retention tenant exists.
  if (anyUnlimited || maxFiniteDays === 0) {
    console.log('[retention] keeping all partitions (an unlimited-retention tenant exists, or no finite plans)');
  } else {
    const cutoff = new Date(Date.now() - maxFiniteDays * DAY_MS).toISOString().slice(0, 10);
    const result = await withSystem(db, 'system-job', (tx) =>
      tx.execute(sql`select trackflow_drop_positions_partitions_before(${cutoff}::date) as n`),
    );
    const dropped = Number((result as unknown as Array<{ n: number | string }>)[0]?.n ?? 0);
    console.log(`[retention] dropped ${dropped} partition(s) entirely older than ${cutoff}`);
  }

  console.log(`[retention] done — ${rows.length} tenant(s) processed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runRetention().then(() => process.exit(0));
}
