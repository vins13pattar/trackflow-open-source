import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env reads UPSTASH_* at module load, so each test sets the vars then imports
// fresh modules to exercise the configured / not-configured branches.
const ORIG_URL = process.env.UPSTASH_REDIS_REST_URL;
const ORIG_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

describe('API presence reader', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (ORIG_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIG_URL;
    if (ORIG_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIG_TOKEN;
    vi.restoreAllMocks();
  });

  it('is not configured and returns null without a shared store', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { presenceConfigured, lookupPresence } = await import('./presence.js');
    expect(presenceConfigured()).toBe(false);
    expect(await lookupPresence('123456789012345')).toBeNull();
  });

  it('resolves the holding instance when Upstash is configured', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://r';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'ingest-2' }) }));
    const { presenceConfigured, lookupPresence } = await import('./presence.js');
    expect(presenceConfigured()).toBe(true);
    expect(await lookupPresence('imei1')).toEqual({ instanceId: 'ingest-2' });
  });

  it('never throws when the store errors — presence is advisory', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://r';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { lookupPresence } = await import('./presence.js');
    expect(await lookupPresence('imei1')).toBeNull();
  });
});
