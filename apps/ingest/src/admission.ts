import { env } from './env.js';

export interface AdmissionRequest {
  imei: string;
  protocol: string;
  transportSecurity: 'development' | 'mtls' | 'private_gateway';
  authenticatedImei?: string;
}

export type AdmissionDecision =
  | { allowed: true; reason: 'allowed'; deviceId: string }
  | {
      allowed: false;
      reason: 'unknown_imei' | 'inactive' | 'protocol_mismatch' | 'identity_mismatch' | 'development_forbidden';
    };

interface CacheEntry {
  decision: AdmissionDecision;
  expiresAt: number;
}

export interface AdmissionClientOptions {
  url: string;
  token: string;
  allowTtlMs: number;
  denyTtlMs: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export class AdmissionClient {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AdmissionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async check(request: AdmissionRequest): Promise<AdmissionDecision> {
    const key = [request.imei, request.protocol, request.transportSecurity, request.authenticatedImei ?? ''].join(':');
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.decision;
    if (cached) this.cache.delete(key);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('admission_timeout')), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(this.options.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-ingest-token': this.options.token,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Admission service rejected request (${response.status})`);
      const decision = (await response.json()) as AdmissionDecision;
      if (
        typeof decision.allowed !== 'boolean' ||
        !['allowed', 'unknown_imei', 'inactive', 'protocol_mismatch', 'identity_mismatch', 'development_forbidden'].includes(
          decision.reason,
        ) ||
        decision.allowed !== (decision.reason === 'allowed') ||
        (decision.allowed &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            decision.deviceId,
          ))
      ) {
        throw new Error('Admission service returned an invalid response');
      }
      const ttl = decision.allowed ? this.options.allowTtlMs : this.options.denyTtlMs;
      this.cache.set(key, { decision, expiresAt: Date.now() + ttl });
      return decision;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cached: AdmissionClient | null = null;

export function getAdmissionClient(): AdmissionClient {
  cached ??= new AdmissionClient({
    url: env.admissionUrl,
    token: env.sinkToken,
    allowTtlMs: env.admissionAllowTtlMs,
    denyTtlMs: env.admissionDenyTtlMs,
    timeoutMs: env.admissionTimeoutMs,
  });
  return cached;
}

export function __resetAdmissionClient(): void {
  cached = null;
}
