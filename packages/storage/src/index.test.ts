import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSignedUrl, loadStorageConfig, putObject, storageConfigured } from './index.js';

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('@trackflow/storage', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it('reports unconfigured when any of the required env vars is missing', () => {
    setEnv({
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });
    expect(storageConfigured()).toBe(false);
    expect(loadStorageConfig()).toBeNull();
  });

  it('putObject is a no-op when storage is unconfigured', async () => {
    setEnv({
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    });
    const url = await putObject('a/b.txt', Buffer.from('hi'), 'text/plain');
    expect(url).toBeNull();
  });

  it('getSignedUrl returns null when storage is unconfigured', () => {
    expect(getSignedUrl('a/b.txt')).toBeNull();
  });

  describe('configured (CF R2-like)', () => {
    beforeEach(() => {
      setEnv({
        S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
        S3_REGION: 'auto',
        S3_BUCKET: 'trackflow',
        S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        S3_SECRET_ACCESS_KEY: 'sk-example',
        S3_PUBLIC_BASE_URL: undefined,
      });
    });

    it('PUTs with a SigV4 Authorization header and content hash', async () => {
      let captured: { url: string; init: RequestInit } | null = null;
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        captured = { url: input.toString(), init: init ?? {} };
        return new Response('', { status: 200 });
      }) as typeof fetch;
      const url = await putObject('invoices/abc.pdf', Buffer.from('PDF'), 'application/pdf');
      expect(url).toBe('https://account.r2.cloudflarestorage.com/trackflow/invoices/abc.pdf');
      expect(captured).not.toBeNull();
      // Signed-V4 fingerprint
      const auth = (captured!.init.headers as Record<string, string>).authorization ?? '';
      expect(auth).toContain('AWS4-HMAC-SHA256');
      expect(auth).toContain('Credential=AKIAEXAMPLE/');
      expect(auth).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
      expect((captured!.init.headers as Record<string, string>)['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns the publicBaseUrl when set', async () => {
      process.env.S3_PUBLIC_BASE_URL = 'https://cdn.trackflow.app';
      globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
      const url = await putObject('reports/x.csv', Buffer.from(''), 'text/csv');
      expect(url).toBe('https://cdn.trackflow.app/reports/x.csv');
    });

    it('throws on non-2xx S3 response', async () => {
      globalThis.fetch = (async () =>
        new Response('Access Denied', { status: 403 })) as typeof fetch;
      await expect(putObject('x.txt', Buffer.from(''), 'text/plain')).rejects.toThrow(/403/);
    });

    it('produces a pre-signed GET URL with required query params', () => {
      const url = getSignedUrl('reports/fleet.csv', 600);
      expect(url).toContain('https://account.r2.cloudflarestorage.com/trackflow/reports/fleet.csv');
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(url).toContain('X-Amz-Credential=');
      expect(url).toContain('X-Amz-Expires=600');
      expect(url).toContain('X-Amz-SignedHeaders=host');
      expect(url).toMatch(/X-Amz-Signature=[a-f0-9]{64}/);
    });
  });
});
