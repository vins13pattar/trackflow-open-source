/**
 * Subscription lifecycle maintenance (cross-tenant system job). Reverts expired
 * trials and post-period canceled subscriptions to the free plan. Runnable on
 * demand (`pnpm jobs:subscriptions`) or on a schedule.
 */
import { pathToFileURL } from 'node:url';
import { and, eq, lt, tenants } from '@trackflow/db';
import { db } from './db.js';

const TO_FREE = {
  plan: 'free',
  subscriptionStatus: 'none',
  billingCycle: null,
  currentPeriodEnd: null,
} as const;

/** Reverts expired trials and post-period cancellations to free. Idempotent. */
export async function expireSubscriptions(now = new Date()): Promise<{ trials: number; canceled: number }> {
  const trials = await db
    .update(tenants)
    .set({ ...TO_FREE, trialEndsAt: null })
    .where(and(eq(tenants.subscriptionStatus, 'trialing'), lt(tenants.trialEndsAt, now)))
    .returning({ id: tenants.id });
  const canceled = await db
    .update(tenants)
    .set(TO_FREE)
    .where(and(eq(tenants.subscriptionStatus, 'canceled'), lt(tenants.currentPeriodEnd, now)))
    .returning({ id: tenants.id });
  return { trials: trials.length, canceled: canceled.length };
}

async function run(): Promise<void> {
  const { trials, canceled } = await expireSubscriptions();
  console.log(`[subscriptions] expired ${trials} trial(s) and ${canceled} canceled subscription(s)`);
  process.exit(0);
}

// Only run the job when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run();
}
