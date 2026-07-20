import { createHmac } from 'node:crypto';
import { devices, eq, invoices, tenants, users, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './env.js';

// Requires a running Postgres with RLS applied (`pnpm db:rls`). Gated so the
// default `pnpm test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;
const WEBHOOK_SECRET = 'whsec_test_billing';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

describe.skipIf(!enabled)('billing: webhook-driven upgrades', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  const envBackup = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const stamp = Date.now();
    const [t] = await db.insert(tenants).values({ name: 'Bill Co', slug: `bill-${stamp}` }).returning();
    tenantId = t!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `owner-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    token = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, (tx) => tx.delete(invoices).where(eq(invoices.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    process.env.NODE_ENV = envBackup;
  });

  function paymentCaptured(paymentId: string) {
    return JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, notes: { tenantId, plan: 'professional', billingCycle: 'monthly' } } } },
    });
  }

  async function tenantPlan(): Promise<string> {
    const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
    return t!.plan;
  }
  async function invoiceCount(): Promise<number> {
    const rows = await withSystem(db, (tx) => tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)));
    return rows.length;
  }

  it('rejects a webhook with an invalid signature', async () => {
    const body = paymentCaptured('pay_bad');
    const res = await app.request('/internal/billing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'not-the-signature' },
      body,
    });
    expect(res.status).toBe(401);
    expect(await tenantPlan()).toBe('free');
  });

  it('upgrades the plan and writes one GST invoice on payment.captured', async () => {
    const body = paymentCaptured('pay_abc123');
    const res = await app.request('/internal/billing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    expect(await tenantPlan()).toBe('professional');

    const rows = await withSystem(db, (tx) => tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('razorpay');
    expect(rows[0]!.providerRef).toBe('pay_abc123');
    expect(rows[0]!.taxInr).toBe(Math.round(rows[0]!.subtotalInr * 0.18));
    expect(rows[0]!.totalInr).toBe(rows[0]!.subtotalInr + rows[0]!.taxInr);
  });

  it('is idempotent when the same payment webhook is redelivered', async () => {
    const body = paymentCaptured('pay_abc123');
    await app.request('/internal/billing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(body) },
      body,
    });
    expect(await invoiceCount()).toBe(1);
  });

  it('serves a downloadable GST PDF for an invoice', async () => {
    const rows = await withSystem(db, (tx) => tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)));
    const res = await app.request(`/billing/invoices/${rows[0]!.id}/pdf`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('.pdf');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(800);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  });

  it('checkout returns a mock order when no payment gateway is configured', async () => {
    const res = await app.request('/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'professional', billingCycle: 'monthly' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mock: boolean; amountInr: number; keyId: string | null };
    expect(body.mock).toBe(true);
    expect(body.keyId).toBeNull();
    expect(body.amountInr).toBeGreaterThan(0);
  });

  it('reaches the /billing/confirm handler outside production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await app.request('/billing/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'starter', billingCycle: 'monthly' }),
    });
    expect(res.status).toBe(200);
  });

  it('blocks /billing/confirm in production (upgrades only via webhook)', async () => {
    process.env.NODE_ENV = 'production';
    const res = await app.request('/billing/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'enterprise', billingCycle: 'monthly' }),
    });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!enabled)('billing: Stripe Checkout + webhook', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  const STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe';

  function stripeSign(body: string, timestamp: string): string {
    return createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  }

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = STRIPE_WEBHOOK_SECRET;
    const stamp = Date.now();
    const [t] = await db.insert(tenants).values({ name: 'Stripe Co', slug: `stripe-${stamp}` }).returning();
    tenantId = t!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `stripe-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    token = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, (tx) => tx.delete(invoices).where(eq(invoices.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  it('returns a mock Checkout Session URL when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await app.request('/billing/checkout-stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'professional', billingCycle: 'monthly' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mock: boolean; sessionId: string; url: string };
    expect(body.mock).toBe(true);
    expect(body.sessionId).toMatch(/^cs_test_mock_/);
    expect(body.url).toContain('/billing/mock-checkout');
  });

  function completedEvent(sessionId: string, paid = true) {
    return JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_status: paid ? 'paid' : 'unpaid',
          metadata: { tenantId, plan: 'professional', billingCycle: 'monthly' },
        },
      },
    });
  }

  it('rejects a webhook with a bad signature', async () => {
    const body = completedEvent('cs_test_bad');
    const ts = Math.floor(Date.now() / 1000).toString();
    const res = await app.request('/internal/billing/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=deadbeef` },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp (>5 min skew)', async () => {
    const body = completedEvent('cs_test_stale');
    const ts = (Math.floor(Date.now() / 1000) - 7200).toString(); // 2h old
    const sig = stripeSign(body, ts);
    const res = await app.request('/internal/billing/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('upgrades the tenant on checkout.session.completed (paid)', async () => {
    const body = completedEvent('cs_test_session_123');
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = stripeSign(body, ts);
    const res = await app.request('/internal/billing/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
      body,
    });
    expect(res.status).toBe(200);
    const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
    expect(t!.plan).toBe('professional');
    const rows = await withSystem(db, (tx) => tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('stripe');
    expect(rows[0]!.providerRef).toBe('cs_test_session_123');
  });

  it('is idempotent on redelivery (single invoice for one session id)', async () => {
    const body = completedEvent('cs_test_session_123');
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = stripeSign(body, ts);
    await app.request('/internal/billing/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
      body,
    });
    const rows = await withSystem(db, (tx) => tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)));
    expect(rows).toHaveLength(1);
  });

  it('does not upgrade when payment_status != paid', async () => {
    // Reset tenant so we can prove the unpaid event is a no-op.
    await db.update(tenants).set({ plan: 'free', subscriptionStatus: 'none' }).where(eq(tenants.id, tenantId));
    const body = completedEvent('cs_test_unpaid', false);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = stripeSign(body, ts);
    const res = await app.request('/internal/billing/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` },
      body,
    });
    expect(res.status).toBe(200);
    const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
    expect(t!.plan).toBe('free');
  });
});

describe.skipIf(!enabled)('billing: plan lifecycle', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  const deviceIds: string[] = [];
  const auth = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const stamp = Date.now();
    const [t] = await db
      .insert(tenants)
      .values({
        name: 'Life Co',
        slug: `life-${stamp}`,
        plan: 'professional',
        subscriptionStatus: 'active',
        billingCycle: 'monthly',
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning();
    tenantId = t!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `life-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    token = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, (tx) => tx.delete(devices).where(eq(devices.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  async function plan(): Promise<string> {
    const [t] = await db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
    return t!.plan;
  }

  it('blocks a downgrade when usage exceeds the target plan limits', async () => {
    const stamp = Date.now();
    for (let i = 0; i < 6; i++) {
      const [d] = await withSystem(db, (tx) =>
        tx.insert(devices).values({ tenantId, name: `d${i}`, imei: `imei-${stamp}-${i}` }).returning(),
      );
      deviceIds.push(d!.id);
    }
    const res = await app.request('/billing/downgrade', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ plan: 'starter' }), // Starter allows 5 devices; we have 6
    });
    expect(res.status).toBe(402);
    expect(await plan()).toBe('professional');
  });

  it('allows the downgrade once usage fits', async () => {
    for (const id of deviceIds.slice(1)) {
      await withSystem(db, (tx) => tx.delete(devices).where(eq(devices.id, id)));
    }
    const res = await app.request('/billing/downgrade', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ plan: 'starter' }),
    });
    expect(res.status).toBe(200);
    expect(await plan()).toBe('starter');
  });

  it('cancels the subscription (kept until period end)', async () => {
    const res = await app.request('/billing/cancel', { method: 'POST', headers: auth() });
    expect(res.status).toBe(200);
    const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(t!.subscriptionStatus).toBe('canceled');
  });
});
