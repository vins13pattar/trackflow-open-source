import { timingSafeEqual } from 'node:crypto';
import { desc, eq, invoices, tenants, withTenant } from '@trackflow/db';
import type { Invoice } from '@trackflow/db';
import { type PlanId, checkoutSchema, downgradeSchema, errors } from '@trackflow/shared';
import { getSignedUrl } from '@trackflow/storage';
import { Hono } from 'hono';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { applyUpgrade, cancelSubscription, changePlan, getBilling } from '../billing-service.js';
import { renderInvoicePdf } from '../invoice-pdf.js';
import { getPlanCatalog, resolvePlanByKey } from '../plan-service.js';
import { db } from '../db.js';
import { env } from '../env.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const billingRoutes = new Hono<AppEnv>();

function toInvoice(i: Invoice) {
  return {
    id: i.id,
    number: i.number,
    plan: i.plan,
    billingCycle: i.billingCycle,
    subtotalInr: i.subtotalInr,
    taxInr: i.taxInr,
    totalInr: i.totalInr,
    currency: i.currency,
    status: i.status,
    lineItems: i.lineItems,
    createdAt: i.createdAt.toISOString(),
  };
}

billingRoutes.get('/plans', async (c) => c.json({ plans: await getPlanCatalog() }));

billingRoutes.get('/subscription', async (c) => {
  const { tenantId } = c.get('principal');
  return c.json(await getBilling(tenantId));
});

billingRoutes.get('/invoices', async (c) => {
  const { tenantId } = c.get('principal');
  const rows = await withTenant(db, tenantId, (tx) =>
    tx.select().from(invoices).orderBy(desc(invoices.createdAt)),
  );
  return c.json({ invoices: rows.map(toInvoice), total: rows.length });
});

// Downloadable GST tax invoice (PDF). When the archived URL exists (post-R2
// upload), redirect to a short-lived pre-signed link so the caller pulls from
// object storage rather than re-rendering. Falls back to on-demand render when
// archival isn't configured.
billingRoutes.get('/invoices/:id/pdf', async (c) => {
  const { tenantId } = c.get('principal');
  const [inv] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(invoices).where(eq(invoices.id, c.req.param('id'))).limit(1),
  );
  if (!inv) throw errors.notFound('Invoice not found');
  if (inv.pdfUrl) {
    // The stored URL is the object's endpoint+path; sign it for 5 minutes.
    const key = `invoices/${tenantId}/${inv.number}.pdf`;
    const signed = getSignedUrl(key, 300);
    if (signed) return c.redirect(signed, 302);
  }
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const pdf = await renderInvoicePdf({ invoice: inv, tenantName: t?.name ?? 'Customer' });
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${inv.number}.pdf"`,
    },
  });
});

async function createRazorpayOrder(amountInr: number, notes: Record<string, string>) {
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    return { id: `order_mock_${crypto.randomUUID().slice(0, 8)}`, mock: true };
  }
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: amountInr * 100, currency: 'INR', notes }),
  });
  if (!res.ok) throw errors.internal('Failed to create Razorpay order');
  const data = (await res.json()) as { id: string };
  return { id: data.id, mock: false };
}

billingRoutes.post('/checkout', requirePermission('billing:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const { plan, billingCycle } = checkoutSchema.parse(await c.req.json());
  const def = await resolvePlanByKey(plan);
  const amountInr = billingCycle === 'annual' ? def.annualInr : def.priceInr;
  const order = await createRazorpayOrder(amountInr, { tenantId, plan, billingCycle });
  return c.json({ orderId: order.id, amountInr, currency: 'INR', keyId: env.razorpay.keyId ?? null, mock: order.mock });
});

/** Stripe Checkout Session for international payments. The session URL is opened
 *  by the client; on payment success Stripe delivers a `checkout.session.completed`
 *  event to the webhook below, which then upgrades the tenant. */
async function createStripeCheckoutSession(
  tenantId: string,
  amountInr: number,
  planName: string,
  cycle: 'monthly' | 'annual',
  plan: PlanId,
): Promise<{ id: string; url: string | null; mock: boolean }> {
  if (!env.stripe.secretKey) {
    const id = `cs_test_mock_${crypto.randomUUID().slice(0, 8)}`;
    return { id, url: `${env.webOrigin}/billing/mock-checkout?session=${id}`, mock: true };
  }
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${env.webOrigin}/billing?status=success&session={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${env.webOrigin}/billing?status=canceled`);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'inr');
  body.set('line_items[0][price_data][product_data][name]', `${planName} plan (${cycle})`);
  // Stripe expects the smallest currency unit (paise for INR).
  body.set('line_items[0][price_data][unit_amount]', String(amountInr * 100));
  body.set('metadata[tenantId]', tenantId);
  body.set('metadata[plan]', plan);
  body.set('metadata[billingCycle]', cycle);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.stripe.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw errors.internal('Failed to create Stripe Checkout Session');
  const data = (await res.json()) as { id: string; url: string | null };
  return { id: data.id, url: data.url, mock: false };
}

billingRoutes.post('/checkout-stripe', requirePermission('billing:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const { plan, billingCycle } = checkoutSchema.parse(await c.req.json());
  const def = await resolvePlanByKey(plan);
  const amountInr = billingCycle === 'annual' ? def.annualInr : def.priceInr;
  const session = await createStripeCheckoutSession(tenantId, amountInr, def.name, billingCycle, plan);
  return c.json({ sessionId: session.id, url: session.url, amountInr, currency: 'INR', mock: session.mock });
});

// Dev/test-only confirmation so the upgrade flow can be exercised without keys.
// In production this is disabled: the upgrade is driven solely by the verified
// Razorpay webhook below, so a client can never flip its own plan without paying.
billingRoutes.post('/confirm', requirePermission('billing:manage'), async (c) => {
  if (env.isProduction) {
    throw errors.forbidden(
      'Manual confirmation is disabled in production; plan upgrades complete via the Razorpay payment webhook.',
    );
  }
  const { tenantId } = c.get('principal');
  const { plan, billingCycle } = checkoutSchema.parse(await c.req.json());
  const invoice = await applyUpgrade(tenantId, plan as PlanId, billingCycle, 'mock');
  return c.json({ subscription: await getBilling(tenantId), invoice: toInvoice(invoice) });
});

// Self-serve downgrade to a lower plan (no charge); blocked if usage won't fit.
billingRoutes.post('/downgrade', requirePermission('billing:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const { plan } = downgradeSchema.parse(await c.req.json());
  await changePlan(tenantId, plan as PlanId);
  await recordAudit({ tenantId, actorUserId: actorUserId(c), actorIp: actorIp(c), action: 'billing.downgraded', target: 'subscription', metadata: { plan } });
  return c.json(await getBilling(tenantId));
});

// Cancel: keep paid access until currentPeriodEnd, then the expiry job reverts to free.
billingRoutes.post('/cancel', requirePermission('billing:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  await cancelSubscription(tenantId);
  await recordAudit({ tenantId, actorUserId: actorUserId(c), actorIp: actorIp(c), action: 'billing.canceled', target: 'subscription' });
  return c.json(await getBilling(tenantId));
});

/** Razorpay webhook (unauthenticated; HMAC-verified). Mounted under /internal. */
export const billingWebhookRoutes = new Hono();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Buffer.from(new Uint8Array(sig)).toString('hex');
}

/** Constant-time signature comparison (avoids leaking the HMAC via timing). */
function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

billingWebhookRoutes.post('/', async (c) => {
  const secret = env.razorpay.webhookSecret;
  if (!secret) return c.json({ skipped: true, reason: 'webhook not configured' }, 501);
  const raw = await c.req.text();
  const signature = c.req.header('x-razorpay-signature') ?? '';
  if (!signaturesMatch(await hmacHex(secret, raw), signature)) {
    throw errors.unauthorized('Invalid signature');
  }

  const event = JSON.parse(raw) as {
    event: string;
    payload?: {
      payment?: { entity?: { id?: string; notes?: Record<string, string> } };
      order?: { entity?: { id?: string; notes?: Record<string, string> } };
    };
  };
  if (event.event === 'payment.captured' || event.event === 'order.paid') {
    // notes carry our {tenantId, plan, billingCycle}; they live on the payment
    // entity for payment.captured and on the order entity for order.paid.
    const entity = event.payload?.payment?.entity ?? event.payload?.order?.entity;
    const notes = entity?.notes ?? {};
    if (notes.tenantId && notes.plan) {
      await applyUpgrade(
        notes.tenantId,
        notes.plan as PlanId,
        (notes.billingCycle as 'monthly' | 'annual') ?? 'monthly',
        'razorpay',
        entity?.id,
      );
    }
  }
  return c.json({ ok: true });
});

/** Parses a `Stripe-Signature` header (`t=<ts>,v1=<sig>[,v1=<sig>...]`). Multiple
 *  v1 values are returned because Stripe ships both the current and previous
 *  signing secret during a rotation. */
function parseStripeSignature(header: string): { timestamp: string; v1: string[] } | null {
  const parts = header.split(',').map((p) => p.trim());
  let timestamp: string | null = null;
  const v1: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't' && v) timestamp = v;
    if (k === 'v1' && v) v1.push(v);
  }
  if (!timestamp || v1.length === 0) return null;
  return { timestamp, v1 };
}

/** Stripe Checkout webhook (`checkout.session.completed`). Mounted under
 *  /internal/billing/stripe. Unauthenticated — protected by Stripe-Signature. */
export const stripeWebhookRoutes = new Hono();

stripeWebhookRoutes.post('/', async (c) => {
  const secret = env.stripe.webhookSecret;
  if (!secret) return c.json({ skipped: true, reason: 'stripe webhook not configured' }, 501);
  const raw = await c.req.text();
  const header = c.req.header('stripe-signature') ?? '';
  const parsed = parseStripeSignature(header);
  if (!parsed) throw errors.unauthorized('Missing or malformed Stripe-Signature');
  // Reject replays of signatures older than 5 minutes (Stripe's recommended tolerance).
  const tsSec = Number(parsed.timestamp);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
    throw errors.unauthorized('Stripe signature timestamp out of tolerance');
  }
  const expected = await hmacHex(secret, `${parsed.timestamp}.${raw}`);
  if (!parsed.v1.some((s) => signaturesMatch(expected, s))) {
    throw errors.unauthorized('Invalid Stripe signature');
  }

  const event = JSON.parse(raw) as {
    type: string;
    data?: { object?: { id?: string; metadata?: Record<string, string>; payment_status?: string } };
  };
  if (event.type === 'checkout.session.completed') {
    const obj = event.data?.object;
    const md = obj?.metadata ?? {};
    // Only credit the upgrade when Stripe says the session was actually paid.
    if (md.tenantId && md.plan && obj?.payment_status === 'paid') {
      await applyUpgrade(
        md.tenantId,
        md.plan as PlanId,
        (md.billingCycle as 'monthly' | 'annual') ?? 'monthly',
        'stripe',
        obj.id,
      );
    }
  }
  return c.json({ ok: true });
});
