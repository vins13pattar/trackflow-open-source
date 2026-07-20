import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureToSentry, parseDsn } from './sentry.js';

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

describe('captureToSentry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts an event to the store endpoint with the auth header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const dsn = parseDsn('https://key123@o42.ingest.sentry.io/987')!;

    await captureToSentry(dsn, new Error('boom'), { requestId: 'r1', tenantId: 't1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://o42.ingest.sentry.io/api/987/store/');
    expect((opts.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=key123');
    const body = JSON.parse(opts.body as string);
    expect(body.exception.values[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(body.extra).toMatchObject({ requestId: 'r1', tenantId: 't1' });
  });

  it('no-ops without a DSN and never throws on transport failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(captureToSentry(null, new Error('x'))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    const dsn = parseDsn('https://k@h.sentry.io/1')!;
    await expect(captureToSentry(dsn, new Error('x'))).resolves.toBeUndefined(); // swallows the rejection
  });
});
