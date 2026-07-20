import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetSessionStore, __test, getSessionStore } from './session-store.js';

const { InMemorySessionStore, UpstashRedisStore } = __test;

describe('InMemorySessionStore', () => {
  it('binds and looks up IMEI', async () => {
    const s = new InMemorySessionStore();
    await s.bindImei('gt06:1.2.3.4:5000', '865432019876543');
    expect(await s.lookupImei('gt06:1.2.3.4:5000')).toBe('865432019876543');
  });

  it('returns null for unknown connection', async () => {
    const s = new InMemorySessionStore();
    expect(await s.lookupImei('gt06:unknown')).toBeNull();
  });

  it('expires bindings past their TTL', async () => {
    const s = new InMemorySessionStore(0.05); // 50 ms TTL
    await s.bindImei('k', '111');
    await new Promise((r) => setTimeout(r, 70));
    expect(await s.lookupImei('k')).toBeNull();
  });

  it('tracks route (which pod owns a device)', async () => {
    const s = new InMemorySessionStore();
    await s.bindRoute('865432019876543', 'pod-a');
    expect(await s.lookupRoute('865432019876543')).toBe('pod-a');
    await s.bindRoute('865432019876543', 'pod-b');
    expect(await s.lookupRoute('865432019876543')).toBe('pod-b');
  });

  it('forget removes the binding', async () => {
    const s = new InMemorySessionStore();
    await s.bindImei('k', '111');
    await s.forget('k');
    expect(await s.lookupImei('k')).toBeNull();
  });
});

describe('UpstashRedisStore', () => {
  it('calls the REST URL with the bearer token and TTL on bindImei', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fakeFetch: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      calls.push({ url, auth });
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
    }) as typeof fetch;

    const s = new UpstashRedisStore('https://example.upstash.io', 'TOKEN', 600, fakeFetch);
    await s.bindImei('gt06:1.2.3.4:5000', '865432019876543');

    expect(calls).toHaveLength(1);
    const first = calls[0]!;
    expect(first.url).toBe(
      'https://example.upstash.io/set/tf%3Aingest%3Aconn%3Agt06%3A1.2.3.4%3A5000/865432019876543/ex/600',
    );
    expect(first.auth).toBe('Bearer TOKEN');
  });

  it('returns the GET result string', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ result: '865432019876543' }), { status: 200 })) as typeof fetch;
    const s = new UpstashRedisStore('https://example.upstash.io', 'TOKEN', 600, fakeFetch);
    expect(await s.lookupImei('k')).toBe('865432019876543');
  });

  it('returns null when GET result is null', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response(JSON.stringify({ result: null }), { status: 200 })) as typeof fetch;
    const s = new UpstashRedisStore('https://example.upstash.io', 'TOKEN', 600, fakeFetch);
    expect(await s.lookupImei('k')).toBeNull();
  });

  it('throws when Upstash returns a non-2xx', async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response('rate limited', { status: 429 })) as typeof fetch;
    const s = new UpstashRedisStore('https://example.upstash.io', 'TOKEN', 600, fakeFetch);
    await expect(s.bindImei('k', '1')).rejects.toThrow(/Upstash set failed: 429/);
  });
});

describe('getSessionStore', () => {
  const originalUrl = process.env.INGEST_REDIS_URL;
  const originalToken = process.env.INGEST_REDIS_TOKEN;

  beforeEach(() => {
    __resetSessionStore();
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.INGEST_REDIS_URL;
    else process.env.INGEST_REDIS_URL = originalUrl;
    if (originalToken === undefined) delete process.env.INGEST_REDIS_TOKEN;
    else process.env.INGEST_REDIS_TOKEN = originalToken;
    __resetSessionStore();
  });

  it('falls back to in-memory when env is unset', () => {
    delete process.env.INGEST_REDIS_URL;
    delete process.env.INGEST_REDIS_TOKEN;
    const s = getSessionStore();
    expect(s).toBeInstanceOf(InMemorySessionStore);
  });

  it('uses Upstash when env is set', () => {
    process.env.INGEST_REDIS_URL = 'https://x.upstash.io';
    process.env.INGEST_REDIS_TOKEN = 'TOKEN';
    const s = getSessionStore();
    expect(s).toBeInstanceOf(UpstashRedisStore);
  });

  it('returns the cached instance on repeat calls', () => {
    const a = getSessionStore();
    const b = getSessionStore();
    expect(a).toBe(b);
  });
});
