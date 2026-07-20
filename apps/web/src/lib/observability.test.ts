import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDsn } from './observability';

describe('parseDsn', () => {
  it('parses a valid DSN', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/987')).toEqual({
      protocol: 'https',
      host: 'o42.ingest.sentry.io',
      projectId: '987',
      publicKey: 'abc123',
    });
  });

  it('returns null for missing or malformed DSNs', () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn('https://o42.ingest.sentry.io/987')).toBeNull(); // no public key
    expect(parseDsn('https://abc@o42.ingest.sentry.io/')).toBeNull(); // no project id
  });
});

describe('reportError', () => {
  const ORIG = process.env.NEXT_PUBLIC_SENTRY_DSN;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = ORIG;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('no-ops (no fetch) when no DSN is configured', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = '';
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { reportError } = await import('./observability');
    reportError(new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an event with the auth header and payload when a DSN is set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key123@o42.ingest.sentry.io/987';
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { reportError } = await import('./observability');

    reportError(new Error('kaboom'), { boundary: 'route' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://o42.ingest.sentry.io/api/987/store/');
    expect((opts.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=key123');
    const body = JSON.parse(opts.body as string);
    expect(body.logger).toBe('trackflow-web');
    expect(body.exception.values[0]).toMatchObject({ type: 'Error', value: 'kaboom' });
    expect(body.extra).toMatchObject({ boundary: 'route' });
  });

  it('never throws even if fetch rejects synchronously', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://k@h.sentry.io/1';
    vi.resetModules();
    vi.stubGlobal('fetch', () => {
      throw new Error('network down');
    });
    const { reportError } = await import('./observability');
    expect(() => reportError(new Error('x'))).not.toThrow();
  });
});
