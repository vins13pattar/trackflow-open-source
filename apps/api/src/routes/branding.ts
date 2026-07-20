import { eq, tenants } from '@trackflow/db';
import { errors, updateBrandingSchema } from '@trackflow/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { actorIp, actorUserId, recordAudit } from '../audit-log.js';
import { fetchCustomHostname, provisionCustomHostname, removeCustomHostname } from '../custom-domain.js';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

const fields = {
  name: tenants.name,
  brandName: tenants.brandName,
  logoUrl: tenants.logoUrl,
  primaryColor: tenants.primaryColor,
  customDomain: tenants.customDomain,
};

function shape(t: {
  name: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
}) {
  return {
    brandName: t.brandName ?? t.name,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
    customDomain: t.customDomain,
  };
}

export const brandingRoutes = new Hono<AppEnv>();

brandingRoutes.get('/', async (c) => {
  const { tenantId } = c.get('principal');
  const [t] = await db.select(fields).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw errors.notFound('Tenant not found');
  return c.json(shape(t));
});

brandingRoutes.put('/', requirePermission('branding:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const body = updateBrandingSchema.parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v;
  try {
    if (Object.keys(patch).length > 0) await db.update(tenants).set(patch).where(eq(tenants.id, tenantId));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw errors.duplicate('That custom domain is already in use');
    throw err;
  }
  const [t] = await db.select(fields).from(tenants).where(eq(tenants.id, tenantId));
  return c.json(shape(t!));
});

// ---------- Cloudflare for SaaS custom domain ----------

const setCustomDomainSchema = z.object({
  hostname: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'must be a valid hostname')
    .max(253),
});

brandingRoutes.get('/custom-domain', requirePermission('branding:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const [t] = await db
    .select({
      hostname: tenants.customDomain,
      hostnameId: tenants.customDomainHostnameId,
      status: tenants.customDomainStatus,
      sslStatus: tenants.customDomainSslStatus,
      verification: tenants.customDomainVerification,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return c.json({
    hostname: t?.hostname ?? null,
    status: t?.status ?? null,
    sslStatus: t?.sslStatus ?? null,
    ownershipVerification: t?.verification ?? null,
  });
});

brandingRoutes.put('/custom-domain', requirePermission('branding:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const { hostname } = setCustomDomainSchema.parse(await c.req.json());
  const lower = hostname.toLowerCase();

  // Tear down any existing CF custom hostname before replacing.
  const [existing] = await db
    .select({ id: tenants.customDomainHostnameId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (existing?.id) {
    try {
      await removeCustomHostname(existing.id);
    } catch (err) {
      // Swallow — CF will GC dangling hostnames; the tenant should be able to
      // re-add a domain even when CF transiently returns an error.
      console.warn(`[branding] failed to remove old CF hostname: ${(err as Error).message}`);
    }
  }

  let cf;
  try {
    cf = await provisionCustomHostname(lower);
  } catch (err) {
    throw errors.internal(`Could not provision custom hostname: ${(err as Error).message}`);
  }

  try {
    await db
      .update(tenants)
      .set({
        customDomain: lower,
        customDomainHostnameId: cf.id,
        customDomainStatus: cf.status,
        customDomainSslStatus: cf.sslStatus,
        customDomainVerification: cf.ownershipVerification,
      })
      .where(eq(tenants.id, tenantId));
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw errors.duplicate('That custom domain is already in use');
    throw err;
  }
  await recordAudit({
    tenantId,
    actorUserId: actorUserId(c),
    actorIp: actorIp(c),
    action: 'branding.custom_domain.set',
    target: 'tenant',
    metadata: { hostname: lower, status: cf.status, mock: cf.mock },
  });
  return c.json({
    hostname: lower,
    status: cf.status,
    sslStatus: cf.sslStatus,
    ownershipVerification: cf.ownershipVerification,
    mock: cf.mock,
  });
});

brandingRoutes.post('/custom-domain/refresh', requirePermission('branding:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const [t] = await db
    .select({ id: tenants.customDomainHostnameId, hostname: tenants.customDomain })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!t?.id || !t.hostname) throw errors.notFound('No custom domain configured');
  const cf = await fetchCustomHostname(t.id);
  if (!cf) throw errors.notFound('Custom hostname is no longer present at the CDN');
  await db
    .update(tenants)
    .set({
      customDomainStatus: cf.status,
      customDomainSslStatus: cf.sslStatus,
      customDomainVerification: cf.ownershipVerification,
    })
    .where(eq(tenants.id, tenantId));
  return c.json({
    hostname: t.hostname,
    status: cf.status,
    sslStatus: cf.sslStatus,
    ownershipVerification: cf.ownershipVerification,
  });
});

brandingRoutes.delete('/custom-domain', requirePermission('branding:manage'), async (c) => {
  const { tenantId } = c.get('principal');
  const [t] = await db
    .select({ id: tenants.customDomainHostnameId, hostname: tenants.customDomain })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (t?.id) {
    try {
      await removeCustomHostname(t.id);
    } catch (err) {
      console.warn(`[branding] CF removal failed (clearing anyway): ${(err as Error).message}`);
    }
  }
  await db
    .update(tenants)
    .set({
      customDomain: null,
      customDomainHostnameId: null,
      customDomainStatus: null,
      customDomainSslStatus: null,
      customDomainVerification: null,
    })
    .where(eq(tenants.id, tenantId));
  if (t?.hostname) {
    await recordAudit({
      tenantId,
      actorUserId: actorUserId(c),
      actorIp: actorIp(c),
      action: 'branding.custom_domain.removed',
      target: 'tenant',
      metadata: { hostname: t.hostname },
    });
  }
  return c.body(null, 204);
});

/** Unauthenticated branding resolution for theming the login page by host/slug. */
export const publicRoutes = new Hono();

publicRoutes.get('/branding', async (c) => {
  const domain = c.req.query('domain');
  const slug = c.req.query('slug');
  const empty = { brandName: null, logoUrl: null, primaryColor: null };
  if (!domain && !slug) return c.json(empty);
  const [t] = await db
    .select(fields)
    .from(tenants)
    .where(domain ? eq(tenants.customDomain, domain) : eq(tenants.slug, slug!));
  if (!t) return c.json(empty);
  const s = shape(t);
  return c.json({ brandName: s.brandName, logoUrl: s.logoUrl, primaryColor: s.primaryColor });
});
