import { MemoryPresenceStore, RedisPresenceStore } from '@trackflow/shared';
import { describe, expect, it } from 'vitest';
import { createPresenceStore } from './presence.js';

// The store implementations are unit-tested in @trackflow/shared; here we only
// assert the ingest factory's default wiring (no Upstash env → in-memory).
describe('createPresenceStore', () => {
  it('uses standard Redis when configured, otherwise the in-memory fallback', () => {
    expect(createPresenceStore()).toBeInstanceOf(process.env.REDIS_URL ? RedisPresenceStore : MemoryPresenceStore);
  });
});
