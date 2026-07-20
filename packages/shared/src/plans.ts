export type PlanId = 'free' | 'starter' | 'professional' | 'enterprise';

export interface PlanLimits {
  /** -1 means unlimited. */
  devices: number;
  users: number;
  geofences: number;
  apiCallsPerMonth: number;
  historyDays: number;
}

export interface PlanDef {
  id: PlanId;
  name: string;
  priceInr: number; // monthly
  annualInr: number;
  limits: PlanLimits;
}

export const GST_RATE = 0.18;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    priceInr: 0,
    annualInr: 0,
    limits: { devices: 1, users: 1, geofences: 2, apiCallsPerMonth: 500, historyDays: 7 },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceInr: 299,
    annualInr: 2999,
    limits: { devices: 5, users: 3, geofences: 10, apiCallsPerMonth: 10_000, historyDays: 90 },
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    priceInr: 999,
    annualInr: 9999,
    limits: { devices: 25, users: 10, geofences: 50, apiCallsPerMonth: 100_000, historyDays: 365 },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceInr: 25_000,
    annualInr: 0, // custom
    limits: { devices: -1, users: -1, geofences: -1, apiCallsPerMonth: -1, historyDays: -1 },
  },
};

export function planDef(id: string): PlanDef {
  return PLANS[id as PlanId] ?? PLANS.free;
}

/** Plans from cheapest to most capable; index doubles as the tier rank. */
export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'professional', 'enterprise'];
export function planRank(id: string): number {
  const i = PLAN_ORDER.indexOf(id as PlanId);
  return i < 0 ? 0 : i;
}

export const isUnlimited = (limit: number): boolean => limit < 0;

/** True if adding one more (i.e. current `count`) stays within `limit`. */
export function withinLimit(count: number, limit: number): boolean {
  return isUnlimited(limit) || count < limit;
}

export function priceFor(plan: PlanId, cycle: 'monthly' | 'annual'): number {
  const def = planDef(plan);
  return cycle === 'annual' ? def.annualInr : def.priceInr;
}
