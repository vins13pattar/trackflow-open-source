import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryPresenceStore, UpstashPresenceStore } from './presence.js';

describe('MemoryPresenceStore', () => {
  it('binds, looks up, and releases a device for an instance', async () => {
    const s = new MemoryPresenceStore();
    await s.online('123456789012345', 'inst-a');
    expect(await s.lookup('123456789012345')).toMatchObject({ instanceId: 'inst-a' });
    await s.offline('123456789012345', 'inst-a');
    expect(await s.lookup('123456789012345')).toBeNull();
  });

  it('a reconnect to another instance takes over the binding', async () => {
    const s = new MemoryPresenceStore();
    await s.online('imei1', 'inst-a');
    await s.online('imei1', 'inst-b'); // device reconnected, LB landed it on B
    expect((await s.lookup('imei1'))?.instanceId).toBe('inst-b');
  });

  it('a late close from the old instance does not evict the newer binding', async () => {
    const s = new MemoryPresenceStore();
    await s.online('imei1', 'inst-a');
    await s.online('imei1', 'inst-b');
    await s.offline('imei1', 'inst-a'); // stale close from A arrives after B took over
    expect((await s.lookup('imei1'))?.instanceId).toBe('inst-b');
  });

  it('expires a stale binding past the TTL', async () => {
    const s = new MemoryPresenceStore(50);
    await s.online('imei1', 'inst-a');
    await new Promise((r) => setTimeout(r, 70));
    expect(await s.lookup('imei1')).toBeNull();
  });
});

describe('UpstashPresenceStore', () => {
  afterEach(() => vi.restoreAllMocks());

  const stub = (impl: (cmd: unknown[]) => unknown) => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string; headers: Record<string, string> }) => ({
      ok: true,
      json: async () => ({ result: impl(JSON.parse(opts.body) as unknown[]) }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('online issues SET with a PX TTL', async () => {
    const fetchMock = stub(() => 'OK');
    const s = new UpstashPresenceStore('https://r', 'tok', 60_000);
    await s.online('imei1', 'inst-a');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body) as string[];
    expect(body).toEqual(['SET', 'presence:imei1', 'inst-a', 'PX', '60000']);
    expect(fetchMock.mock.calls[0]![1].headers.authorization).toBe('Bearer tok');
  });

  it('lookup returns the holder instance id', async () => {
    stub((cmd) => (cmd[0] === 'GET' ? 'inst-b' : null));
    const s = new UpstashPresenceStore('https://r', 'tok');
    expect((await s.lookup('imei1'))?.instanceId).toBe('inst-b');
  });

  it('offline deletes only when this instance still owns the key', async () => {
    // Owner matches → GET then DEL (2 calls).
    const owned = stub((cmd) => (cmd[0] === 'GET' ? 'inst-a' : 1));
    const s = new UpstashPresenceStore('https://r', 'tok');
    await s.offline('imei1', 'inst-a');
    expect(owned.mock.calls.map((c) => JSON.parse(c[1].body)[0])).toEqual(['GET', 'DEL']);

    // Owner differs → GET only, no DEL.
    const taken = stub((cmd) => (cmd[0] === 'GET' ? 'inst-b' : 1));
    await s.offline('imei1', 'inst-a');
    expect(taken.mock.calls.map((c) => JSON.parse(c[1].body)[0])).toEqual(['GET']);
  });

  it('throws on a non-2xx response so callers can report it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const s = new UpstashPresenceStore('https://r', 'tok');
    await expect(s.lookup('imei1')).rejects.toThrow(/Upstash presence store error: 500/);
  });
});
