import { and, eq, sql, tenants, usageCounters, withTenant } from '@trackflow/db';
import { errors, isUnlimited } from '@trackflow/shared';
import { db } from './db.js';
import { resolveTenantPlan } from './plan-service.js';

// Fraction the monthly API quota may be exceeded before requests are blocked
// (e.g. 0.1 = a 10% grace buffer). Default 0 = enforce the exact limit.
const GRACE = Number(process.env.USAGE_GRACE_FRACTION ?? 0);

/** Current usage period as 'YYYY-MM' (UTC). */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const COUNTER_COLUMNS = {
  apiCalls: usageCounters.apiCalls,
  smsSent: usageCounters.smsSent,
  whatsappSent: usageCounters.whatsappSent,
  emailSent: usageCounters.emailSent,
} as const;
type CounterField = keyof typeof COUNTER_COLUMNS;

/** Atomically increments a counter for the tenant's current period; returns the new value. */
async function bump(tenantId: string, field: CounterField, by: number): Promise<number> {
  const period = currentPeriod();
  const column = COUNTER_COLUMNS[field];
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .insert(usageCounters)
      .values({ tenantId, period, [field]: by })
      .onConflictDoUpdate({
        target: [usageCounters.tenantId, usageCounters.period],
        set: { [field]: sql`${column} + ${by}`, updatedAt: sql`now()` },
      })
      .returning({ value: column }),
  );
  return row?.value ?? 0;
}

/** Counts one API call and enforces the plan's monthly quota (throws 402 when over). */
export async function meterApiCall(tenantId: string): Promise<void> {
  const [t] = await db
    .select({ plan: tenants.plan, planVersionId: tenants.planVersionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const def = await resolveTenantPlan(t ?? {});
  const limit = def.limits.apiCallsPerMonth;
  const count = await bump(tenantId, 'apiCalls', 1);
  if (!isUnlimited(limit) && count > Math.floor(limit * (1 + GRACE))) {
    throw errors.quota(`Monthly API quota exceeded (${limit} calls on the ${def.key} plan). Upgrade for more.`);
  }
}

/** Counts delivered comms (metering only; overage billing is computed separately). */
export async function meterSms(tenantId: string, count: number): Promise<void> {
  if (count > 0) await bump(tenantId, 'smsSent', count);
}
export async function meterWhatsapp(tenantId: string, count: number): Promise<void> {
  if (count > 0) await bump(tenantId, 'whatsappSent', count);
}
export async function meterEmail(tenantId: string, count: number): Promise<void> {
  if (count > 0) await bump(tenantId, 'emailSent', count);
}

export interface Usage {
  apiCalls: number;
  smsSent: number;
  whatsappSent: number;
  emailSent: number;
}

/** Usage for the tenant in the given period (defaults to the current period). */
export async function getUsage(tenantId: string, period: string = currentPeriod()): Promise<Usage> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        apiCalls: usageCounters.apiCalls,
        smsSent: usageCounters.smsSent,
        whatsappSent: usageCounters.whatsappSent,
        emailSent: usageCounters.emailSent,
      })
      .from(usageCounters)
      .where(and(eq(usageCounters.tenantId, tenantId), eq(usageCounters.period, period))),
  );
  return {
    apiCalls: row?.apiCalls ?? 0,
    smsSent: row?.smsSent ?? 0,
    whatsappSent: row?.whatsappSent ?? 0,
    emailSent: row?.emailSent ?? 0,
  };
}
