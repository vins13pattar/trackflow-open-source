import { and, devices, eq, type Invoice, invoices, sql, tenants, type Tx, users, withSystem, withTenant } from '@trackflow/db';
import { GST_RATE, type PlanId, errors, planRank, withinLimit } from '@trackflow/shared';
import { db, systemDb } from './db.js';
import { getBilledRate } from './billing-rates-service.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { currentVersionId, resolvePlanByKey, resolveTenantPlan } from './plan-service.js';
import { putObject } from '@trackflow/storage';
import { getUsage } from './usage-service.js';

/** Metered resources billed as overage, mapped to their usage counter. */
const METERED: ReadonlyArray<{ resource: string; usageKey: 'smsSent' | 'whatsappSent' | 'emailSent' }> = [
  { resource: 'sms', usageKey: 'smsSent' },
  { resource: 'whatsapp', usageKey: 'whatsappSent' },
  { resource: 'email', usageKey: 'emailSent' },
];

export interface OverageItem {
  resource: string;
  included: number;
  used: number;
  overage: number;
  ratePerUnitInr: number;
  amountInr: number;
}

/** Metered overage = (used − included) × billed rate for a period (default: the
 *  current one), soft-capped — usage is allowed past the included quota and
 *  billed, never blocked. */
export async function computeOverages(tenantId: string, period?: string): Promise<{ items: OverageItem[]; totalInr: number }> {
  const [t] = await db
    .select({ plan: tenants.plan, planVersionId: tenants.planVersionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const def = await resolveTenantPlan(t ?? {});
  const usage = await getUsage(tenantId, period);

  const items: OverageItem[] = [];
  let totalInr = 0;
  for (const m of METERED) {
    const rate = await getBilledRate(m.resource);
    if (!rate) continue;
    const included = def.includedUnits[m.resource] ?? 0;
    const used = usage[m.usageKey];
    const overage = Math.max(0, used - included);
    const amountInr = Math.round(overage * rate.ratePerUnitInr * 100) / 100;
    items.push({ resource: m.resource, included, used, overage, ratePerUnitInr: rate.ratePerUnitInr, amountInr });
    totalInr += amountInr;
  }
  return { items, totalInr: Math.round(totalInr * 100) / 100 };
}

/** Period 'YYYY-MM' → [start, end] timestamps (UTC). */
function periodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y!, m! - 1, 1)), end: new Date(Date.UTC(y!, m!, 0, 23, 59, 59)) };
}

/** Bills a period's metered overages as a 'due' invoice. Idempotent per
 *  tenant+period; returns the invoice, or null when there's nothing to bill. */
export async function invoiceOverages(tenantId: string, period: string): Promise<Invoice | null> {
  const providerRef = `overage:${period}`;
  const [existing] = await withSystem(systemDb, 'billing-provider', (tx) =>
    tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.provider, 'metered'), eq(invoices.providerRef, providerRef)))
      .limit(1),
  );
  if (existing) return existing;

  const { items, totalInr } = await computeOverages(tenantId, period);
  const billable = items.filter((i) => i.overage > 0);
  if (billable.length === 0 || totalInr <= 0) return null;

  const subtotal = Math.round(totalInr);
  const tax = Math.round(subtotal * GST_RATE);
  const { start, end } = periodBounds(period);
  return withSystem(systemDb, 'billing-provider', async (tx) => {
    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId,
        number: invoiceNumber(),
        plan: '(metered)',
        billingCycle: 'metered',
        periodStart: start,
        periodEnd: end,
        subtotalInr: subtotal,
        taxInr: tax,
        totalInr: subtotal + tax,
        status: 'due',
        provider: 'metered',
        providerRef,
        lineItems: billable.map((i) => ({ description: `${i.resource} overage — ${i.overage} × ₹${i.ratePerUnitInr.toFixed(2)}`, amountInr: Math.round(i.amountInr) })),
      })
      .returning();
    return inv!;
  });
}

async function tenantPlan(tenantId: string): Promise<PlanId> {
  const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
  return (t?.plan ?? 'free') as PlanId;
}

/** Throws QUOTA_EXCEEDED if the tenant is at its device limit. Runs on the request tx (RLS-scoped count). */
export async function assertDeviceQuota(tx: Tx, tenantId: string): Promise<void> {
  const [t] = await tx
    .select({ plan: tenants.plan, planVersionId: tenants.planVersionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const def = await resolveTenantPlan(t ?? {});
  const [row] = await tx.select({ n: sql<string>`count(*)` }).from(devices);
  if (!withinLimit(Number(row?.n ?? 0), def.limits.devices)) {
    throw errors.quota(`Device limit reached on the ${def.key} plan. Upgrade to add more devices.`);
  }
}

export async function assertUserQuota(tenantId: string): Promise<void> {
  const [t] = await db
    .select({ plan: tenants.plan, planVersionId: tenants.planVersionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const def = await resolveTenantPlan(t ?? {});
  const [row] = await db.select({ n: sql<string>`count(*)` }).from(users).where(eq(users.tenantId, tenantId));
  if (!withinLimit(Number(row?.n ?? 0), def.limits.users)) {
    throw errors.quota(`User limit reached on the ${def.key} plan. Upgrade to invite more users.`);
  }
}

export async function getBilling(tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const def = await resolveTenantPlan(t ?? {});
  const [uc] = await db.select({ n: sql<string>`count(*)` }).from(users).where(eq(users.tenantId, tenantId));
  const usage = await withTenant(db, tenantId, async (tx) => {
    const [dc] = await tx.select({ n: sql<string>`count(*)` }).from(devices);
    return { devices: Number(dc?.n ?? 0) };
  });
  const metered = await getUsage(tenantId);
  const trialDaysLeft =
    t?.subscriptionStatus === 'trialing' && t?.trialEndsAt
      ? Math.max(0, Math.ceil((t.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : null;
  return {
    plan: def.key,
    planName: def.name,
    status: t?.subscriptionStatus ?? 'none',
    billingCycle: t?.billingCycle ?? null,
    trialEndsAt: t?.trialEndsAt ? t.trialEndsAt.toISOString() : null,
    trialDaysLeft,
    currentPeriodEnd: t?.currentPeriodEnd ? t.currentPeriodEnd.toISOString() : null,
    limits: def.limits,
    usage: {
      devices: usage.devices,
      users: Number(uc?.n ?? 0),
      apiCalls: metered.apiCalls,
      smsSent: metered.smsSent,
      whatsappSent: metered.whatsappSent,
      emailSent: metered.emailSent,
    },
    overages: await computeOverages(tenantId),
  };
}

const overLimit = (count: number, limit: number): boolean => limit >= 0 && count > limit;

/** Bills metered overages for every tenant for a closed period (operator/cron
 *  triggered). Idempotent via invoiceOverages's per-tenant+period dedup. */
export async function closePeriodOverages(period: string): Promise<{ tenants: number; billed: number; totalInr: number }> {
  const rows = await withSystem(systemDb, 'billing-provider', (tx) => tx.select({ id: tenants.id }).from(tenants));
  let billed = 0;
  let totalInr = 0;
  for (const t of rows) {
    const inv = await invoiceOverages(t.id, period);
    if (inv) {
      billed += 1;
      totalInr += inv.totalInr;
    }
  }
  return { tenants: rows.length, billed, totalInr };
}

/** Throws QUOTA_EXCEEDED if current usage wouldn't fit within `target`'s limits. */
export async function assertFitsPlan(tenantId: string, target: PlanId): Promise<void> {
  const limits = (await resolvePlanByKey(target)).limits;
  const usage = await withTenant(db, tenantId, async (tx) => {
    const [dc] = await tx.select({ n: sql<string>`count(*)` }).from(devices);
    return Number(dc?.n ?? 0);
  });
  const [uc] = await db.select({ n: sql<string>`count(*)` }).from(users).where(eq(users.tenantId, tenantId));
  const userCount = Number(uc?.n ?? 0);
  if (overLimit(usage, limits.devices)) {
    throw errors.quota(`You have ${usage} devices; the ${target} plan allows ${limits.devices}. Remove devices before switching.`);
  }
  if (overLimit(userCount, limits.users)) {
    throw errors.quota(`You have ${userCount} users; the ${target} plan allows ${limits.users}. Remove users before switching.`);
  }
}

/** Self-serve downgrade to a lower plan (no charge). Blocks if usage won't fit. */
export async function changePlan(tenantId: string, target: PlanId): Promise<void> {
  const current = await tenantPlan(tenantId);
  if (planRank(target) >= planRank(current)) {
    throw errors.validation('Use checkout to move to a higher plan.');
  }
  await assertFitsPlan(tenantId, target);
  const isFree = target === 'free';
  await db
    .update(tenants)
    .set({
      plan: target,
      planVersionId: await currentVersionId(target),
      subscriptionStatus: isFree ? 'none' : 'active',
      ...(isFree ? { billingCycle: null, currentPeriodEnd: null } : {}),
    })
    .where(eq(tenants.id, tenantId));
}

/** Cancels the subscription; paid access continues until currentPeriodEnd, after
 *  which the subscriptions expiry job reverts the tenant to free. */
export async function cancelSubscription(tenantId: string): Promise<void> {
  await db.update(tenants).set({ subscriptionStatus: 'canceled' }).where(eq(tenants.id, tenantId));
}

function invoiceNumber(): string {
  return `INV-${new Date().getFullYear()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** Upgrades the tenant's plan and writes a GST invoice. Returns the invoice. */
export async function applyUpgrade(
  tenantId: string,
  plan: PlanId,
  cycle: 'monthly' | 'annual',
  provider: string,
  providerRef?: string,
): Promise<Invoice> {
  // Idempotency: payment webhooks can be redelivered. If we already recorded an
  // invoice for this provider reference, return it without re-applying the upgrade.
  if (providerRef) {
    const [existing] = await withSystem(systemDb, 'billing-provider', (tx) =>
      tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.provider, provider), eq(invoices.providerRef, providerRef)))
        .limit(1),
    );
    if (existing) return existing;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  if (cycle === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  else periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Price + version are resolved from the DB catalog and the version is pinned,
  // so a later admin price change never re-bills this subscriber.
  const def = await resolvePlanByKey(plan);
  await db
    .update(tenants)
    .set({ plan, planVersionId: def.versionId, subscriptionStatus: 'active', billingCycle: cycle, currentPeriodEnd: periodEnd })
    .where(eq(tenants.id, tenantId));

  const subtotal = cycle === 'annual' ? def.annualInr : def.priceInr;
  const tax = Math.round(subtotal * GST_RATE);
  const total = subtotal + tax;

  const invoice = await withSystem(systemDb, 'billing-provider', async (tx) => {
    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId,
        number: invoiceNumber(),
        plan,
        billingCycle: cycle,
        periodStart: now,
        periodEnd,
        subtotalInr: subtotal,
        taxInr: tax,
        totalInr: total,
        status: 'paid',
        provider,
        providerRef: providerRef ?? null,
        lineItems: [{ description: `${def.name} plan (${cycle})`, amountInr: subtotal }],
      })
      .returning();
    return inv!;
  });

  // Best-effort archive: render the PDF and upload to object storage. Failure
  // here must not roll back the upgrade — the customer's plan changed, the
  // invoice row exists, and the PDF can always be re-rendered on demand.
  try {
    const [tenantRow] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    const pdf = await renderInvoicePdf({ invoice, tenantName: tenantRow?.name ?? 'Customer' });
    const url = await putObject(`invoices/${tenantId}/${invoice.number}.pdf`, Buffer.from(pdf), 'application/pdf');
    if (url) {
      await withSystem(systemDb, 'billing-provider', (tx) => tx.update(invoices).set({ pdfUrl: url }).where(eq(invoices.id, invoice.id)));
      invoice.pdfUrl = url;
    }
  } catch (err) {
    console.warn(`[billing] invoice PDF archive failed: ${(err as Error).message}`);
  }
  return invoice;
}
