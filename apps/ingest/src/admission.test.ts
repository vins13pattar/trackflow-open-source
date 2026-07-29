import { describe, expect, it, vi } from 'vitest';
import { AdmissionClient } from './admission.js';

function client(fetchImpl: typeof fetch, allowTtlMs = 60_000): AdmissionClient {
  return new AdmissionClient({
    url: 'https://api.example/internal/devices/admission',
    token: 'secret',
    allowTtlMs,
    denyTtlMs: 10_000,
    timeoutMs: 500,
    fetchImpl,
  });
}

const request = {
  imei: '123456789012345',
  protocol: 'gt06',
  transportSecurity: 'mtls' as const,
  authenticatedImei: '123456789012345',
};

describe('AdmissionClient', () => {
  it('authenticates the request and caches an allow decision', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ allowed: true, reason: 'allowed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const admission = client(fetchImpl);

    await expect(admission.check(request)).resolves.toEqual({ allowed: true, reason: 'allowed' });
    await expect(admission.check(request)).resolves.toEqual({ allowed: true, reason: 'allowed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ 'x-ingest-token': 'secret', 'content-type': 'application/json' }),
    );
  });

  it('fails closed on service errors and invalid responses', async () => {
    await expect(client(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))).check(request)).rejects.toThrow(
      /503/,
    );
    await expect(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({ allowed: true, reason: 'unknown_imei' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ).check(request),
    ).rejects.toThrow(/invalid response/);
  });
});
