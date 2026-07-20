import { eq, tenants } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { expireSubscriptions } from './subscriptions.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('subscriptions expiry', () => {
  const ids: string[] = [];
  let expiredTrial: string;
  let activeTrial: string;
  let expiredCancel: string;

  async function make(values: Record<string, unknown>): Promise<string> {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Subs', slug: `subs-${Math.random().toString(36).slice(2, 10)}`, ...values })
      .returning();
    ids.push(t!.id);
    return t!.id;
  }
  const get = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0]!;

  beforeAll(async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 7 * 86_400_000);
    expiredTrial = await make({ plan: 'professional', subscriptionStatus: 'trialing', trialEndsAt: past, currentPeriodEnd: past });
    activeTrial = await make({ plan: 'professional', subscriptionStatus: 'trialing', trialEndsAt: future, currentPeriodEnd: future });
    expiredCancel = await make({ plan: 'starter', subscriptionStatus: 'canceled', currentPeriodEnd: past });
  });

  afterAll(async () => {
    for (const id of ids) await db.delete(tenants).where(eq(tenants.id, id));
  });

  it('reverts expired trials and post-period cancellations to free, leaving active trials', async () => {
    const res = await expireSubscriptions();
    expect(res.trials).toBeGreaterThanOrEqual(1);
    expect(res.canceled).toBeGreaterThanOrEqual(1);

    const et = await get(expiredTrial);
    expect(et.plan).toBe('free');
    expect(et.subscriptionStatus).toBe('none');

    const ac = await get(activeTrial);
    expect(ac.plan).toBe('professional');
    expect(ac.subscriptionStatus).toBe('trialing');

    const ec = await get(expiredCancel);
    expect(ec.plan).toBe('free');
    expect(ec.subscriptionStatus).toBe('none');
  });
});
