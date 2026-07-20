/**
 * Cloudflare for SaaS — custom hostname provisioning.
 *
 * When CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID are configured the tenant
 * branding endpoint calls Cloudflare to register the hostname and tracks its
 * activation status (pending → active) plus the DNS challenge (`ownership_
 * verification`) the customer has to add to their authoritative DNS to prove
 * control. Without those env vars the calls degrade to a mocked "active"
 * response so dev work can proceed without a real CF account.
 *
 * Cloudflare API reference:
 *   POST /zones/{zone_id}/custom_hostnames
 *   GET  /zones/{zone_id}/custom_hostnames/{id}
 *   DELETE /zones/{zone_id}/custom_hostnames/{id}
 */
import { env } from './env.js';

export interface CustomHostname {
  id: string;
  hostname: string;
  status: 'pending' | 'active' | 'moved' | 'pending_deletion' | 'pending_blocked' | 'pending_migration' | 'deleted' | 'mock';
  sslStatus: 'pending_validation' | 'active' | 'expired' | 'mock' | null;
  ownershipVerification: { name?: string; value?: string; type?: string } | null;
  mock: boolean;
}

interface RawCfHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string };
  ownership_verification?: { name?: string; value?: string; type?: string };
}

interface RawCfResponse {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: RawCfHostname;
}

function isCfConfigured(): boolean {
  return !!env.cloudflare.apiToken && !!env.cloudflare.zoneId;
}

function mockHostname(hostname: string): CustomHostname {
  return {
    id: `mock_${hostname.replace(/[^a-z0-9]/gi, '_')}`,
    hostname,
    status: 'mock',
    sslStatus: 'mock',
    ownershipVerification: null,
    mock: true,
  };
}

function shape(raw: RawCfHostname): CustomHostname {
  return {
    id: raw.id,
    hostname: raw.hostname,
    status: raw.status as CustomHostname['status'],
    sslStatus: (raw.ssl?.status ?? null) as CustomHostname['sslStatus'],
    ownershipVerification: raw.ownership_verification
      ? {
          name: raw.ownership_verification.name,
          value: raw.ownership_verification.value,
          type: raw.ownership_verification.type,
        }
      : null,
    mock: false,
  };
}

async function cfFetch(method: string, path: string, body?: unknown): Promise<RawCfResponse> {
  const res = await fetch(`${env.cloudflare.apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.cloudflare.apiToken}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as RawCfResponse;
  if (!res.ok || !data.success) {
    const detail = data.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`Cloudflare API call failed (${path}): ${detail}`);
  }
  return data;
}

export async function provisionCustomHostname(hostname: string): Promise<CustomHostname> {
  if (!isCfConfigured()) return mockHostname(hostname);
  const data = await cfFetch('POST', `/zones/${env.cloudflare.zoneId}/custom_hostnames`, {
    hostname,
    ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
  });
  return shape(data.result!);
}

export async function fetchCustomHostname(hostnameId: string): Promise<CustomHostname | null> {
  if (!isCfConfigured()) return mockHostname(`mock-${hostnameId}`);
  if (hostnameId.startsWith('mock_')) return null;
  const data = await cfFetch('GET', `/zones/${env.cloudflare.zoneId}/custom_hostnames/${hostnameId}`);
  return shape(data.result!);
}

export async function removeCustomHostname(hostnameId: string): Promise<void> {
  if (!isCfConfigured() || hostnameId.startsWith('mock_')) return;
  await cfFetch('DELETE', `/zones/${env.cloudflare.zoneId}/custom_hostnames/${hostnameId}`);
}
