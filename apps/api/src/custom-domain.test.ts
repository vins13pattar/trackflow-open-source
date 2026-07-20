import { eq, tenants, users, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './env.js';

const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('Custom domain (Cloudflare for SaaS)', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;

  beforeAll(async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
    const stamp = Date.now();
    const [t] = await db.insert(tenants).values({ name: 'Domain Co', slug: `domain-${stamp}` }).returning();
    tenantId = t!.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `dom-${stamp}@example.com`, passwordHash: 'x', name: 'Owner', role: 'owner' })
      .returning();
    token = (await issueTokens({ sub: u!.id, tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
  });

  afterAll(async () => {
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

  it('GET returns null when no custom domain is configured', async () => {
    const res = await app.request('/branding/custom-domain', { headers: headers() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hostname: string | null; status: string | null };
    expect(body.hostname).toBeNull();
    expect(body.status).toBeNull();
  });

  it('PUT stores a hostname; without CF config the status is "mock"', async () => {
    const res = await app.request('/branding/custom-domain', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ hostname: 'tracking.example.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hostname: string; status: string; mock: boolean };
    expect(body.hostname).toBe('tracking.example.com');
    expect(body.status).toBe('mock');
    expect(body.mock).toBe(true);
  });

  it('GET reflects the stored hostname after a PUT', async () => {
    const res = await app.request('/branding/custom-domain', { headers: headers() });
    const body = (await res.json()) as { hostname: string; status: string };
    expect(body.hostname).toBe('tracking.example.com');
    expect(body.status).toBe('mock');
  });

  it('rejects malformed hostnames', async () => {
    const res = await app.request('/branding/custom-domain', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ hostname: 'not a domain' }),
    });
    expect(res.status).toBe(400);
  });

  it('refresh updates status from CF (mocked → mock)', async () => {
    const res = await app.request('/branding/custom-domain/refresh', { method: 'POST', headers: headers() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('mock');
  });

  it('DELETE clears the hostname and follow-up GET returns null', async () => {
    const del = await app.request('/branding/custom-domain', { method: 'DELETE', headers: headers() });
    expect(del.status).toBe(204);
    const after = (await (await app.request('/branding/custom-domain', { headers: headers() })).json()) as {
      hostname: string | null;
    };
    expect(after.hostname).toBeNull();
  });

  it('refusing to refresh when no domain is configured (404)', async () => {
    const res = await app.request('/branding/custom-domain/refresh', { method: 'POST', headers: headers() });
    expect(res.status).toBe(404);
  });

  it('hits the Cloudflare API when CLOUDFLARE_API_TOKEN + ZONE_ID are set (uses a stubbed fetch)', async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            id: 'cf-real-id-123',
            hostname: 'tracking.example.com',
            status: 'pending',
            ssl: { status: 'pending_validation' },
            ownership_verification: { name: '_cf-acme', value: 'abc', type: 'txt' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    process.env.CLOUDFLARE_ZONE_ID = 'zone';
    try {
      const res = await app.request('/branding/custom-domain', {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ hostname: 'tracking.example.com' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        ownershipVerification: { name: string; value: string; type: string };
        mock: boolean;
      };
      expect(body.status).toBe('pending');
      expect(body.ownershipVerification.name).toBe('_cf-acme');
      expect(body.mock).toBe(false);
      // Exactly one POST to the CF API.
      expect(calls.some((c) => c.startsWith('POST') && c.includes('/zones/zone/custom_hostnames'))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ZONE_ID;
    }
  });
});
