import { MemoryPresenceStore } from '@trackflow/shared';
import { describe, expect, it } from 'vitest';
import { createPresenceStore } from './presence.js';

// The store implementations are unit-tested in @trackflow/shared; here we only
// assert the ingest factory's default wiring (no Upstash env → in-memory).
describe('createPresenceStore', () => {
  it('returns an in-memory store when Upstash is not configured', () => {
    expect(createPresenceStore()).toBeInstanceOf(MemoryPresenceStore);
  });
});
