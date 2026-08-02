import { eq, samlConfigs, tenants, users, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { systemDb as db } from './db.js';
import { env } from './env.js';
import { extractProfile } from './saml.js';

const enabled = !!process.env.TF_DB_TESTS;

describe('SAML profile extraction', () => {
  const baseCfg = {
    id: 'x',
    tenantId: 'x',
    enabled: true,
    entityId: 'http://idp.example.com',
    ssoUrl: 'https://idp.example.com/sso',
    certificate: 'pem',
    audience: 'aud',
    acsUrl: 'acs',
    attributeEmail: 'email',
    attributeName: 'displayName',
    defaultRole: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('reads email + displayName from the configured attribute names', () => {
    const p = extractProfile(baseCfg, { email: 'a@b.com', displayName: 'Alice Wonder' }, undefined);
    expect(p).toEqual({ email: 'a@b.com', name: 'Alice Wonder' });
  });

  it('falls back to NameID when the email attribute is absent', () => {
    const p = extractProfile(baseCfg, {}, 'fallback@example.com');
    expect(p?.email).toBe('fallback@example.com');
  });

  it('lowercases the email and tolerates array-valued attributes', () => {
    const p = extractProfile(baseCfg, { email: ['UPPER@Example.COM'], displayName: ['Bob'] }, undefined);
    expect(p).toEqual({ email: 'upper@example.com', name: 'Bob' });
  });

  it('returns null when no usable email is found', () => {
    expect(extractProfile(baseCfg, {}, undefined)).toBeNull();
    expect(extractProfile(baseCfg, { email: 'not-an-email' }, undefined)).toBeNull();
  });
});

describe.skipIf(!enabled)('SAML config CRUD + metadata', () => {
  const app = createApp();
  let tenantId: string;
  let tenantSlug: string;
  let ownerToken: string;

  beforeAll(async () => {
    const stamp = Date.now();
    tenantSlug = `saml-${stamp}`;
    const [t] = await db.insert(tenants).values({ name: 'SAML Co', slug: tenantSlug }).returning();
    tenantId = t!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `owner-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    ownerToken = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
  });

  afterAll(async () => {
    if (tenantId) {
      await withSystem(db, 'test-fixture', (tx) => tx.delete(samlConfigs).where(eq(samlConfigs.tenantId, tenantId)));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
  });

  const FAKE_CERT =
    'MIICXTCCAcagAwIBAgIBADANBgkqhkiG9w0BAQ0FADBLMQswCQYDVQQGEwJVUzEL\n' +
    'MAkGA1UECAwCQ0ExFTATBgNVBAoMDFRydXN0ZWRJZFAxFzAVBgNVBAMMDmlkcC5l\n' +
    'eGFtcGxlLmNvbTAeFw0yNjAxMDEwMDAwMDBaFw0zNjAxMDEwMDAwMDBa';

  it('returns {enabled:false, configured:false} when no SSO is configured', async () => {
    const res = await app.request('/saml-config', { headers: { authorization: `Bearer ${ownerToken}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; configured: boolean };
    expect(body.configured).toBe(false);
    expect(body.enabled).toBe(false);
  });

  it('PUT creates a config; subsequent GET reflects it (cert not echoed)', async () => {
    const res = await app.request('/saml-config', {
      method: 'PUT',
      headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        entityId: 'https://idp.example.com',
        ssoUrl: 'https://idp.example.com/sso',
        certificate: FAKE_CERT,
        attributeEmail: 'email',
        attributeName: 'displayName',
        defaultRole: 'user',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; entityId: string; acsUrl: string; configured: boolean };
    expect(body.configured).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.entityId).toBe('https://idp.example.com');
    // ACS URL is derived from the webOrigin + tenant slug.
    expect(body.acsUrl).toContain(`/auth/saml/${tenantSlug}/acs`);
    expect(JSON.stringify(body)).not.toContain(FAKE_CERT.slice(0, 30));
  });

  it('publishes SP metadata XML at /auth/saml/:slug/metadata', async () => {
    const res = await app.request(`/auth/saml/${tenantSlug}/metadata`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/samlmetadata+xml');
    const xml = await res.text();
    expect(xml).toContain('EntityDescriptor');
    expect(xml).toContain(`/auth/saml/${tenantSlug}/acs`);
  });

  it('GET /auth/saml/:slug/login 302s to the IdP entry URL', async () => {
    const res = await app.request(`/auth/saml/${tenantSlug}/login`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/^https:\/\/idp\.example\.com\/sso/);
    expect(loc).toContain('SAMLRequest=');
  });

  it('refuses ACS without a SAMLResponse parameter', async () => {
    const res = await app.request(`/auth/saml/${tenantSlug}/acs`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'RelayState=/',
    });
    // 400 validation (missing SAMLResponse).
    expect(res.status).toBe(400);
  });

  it('404s on unknown slug', async () => {
    const res = await app.request('/auth/saml/no-such-tenant/metadata');
    expect(res.status).toBe(404);
  });

  it('DELETE disables SSO; metadata then 404s', async () => {
    const del = await app.request('/saml-config', { method: 'DELETE', headers: { authorization: `Bearer ${ownerToken}` } });
    expect(del.status).toBe(204);
    const meta = await app.request(`/auth/saml/${tenantSlug}/metadata`);
    expect(meta.status).toBe(404);
  });
});
