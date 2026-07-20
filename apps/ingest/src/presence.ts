/**
 * Ingest-side presence factory. The store implementations live in
 * `@trackflow/shared` (so the API can read the same registry); this picks the
 * shared Upstash store when configured, else the in-memory one.
 */
import { MemoryPresenceStore, type PresenceStore, UpstashPresenceStore } from '@trackflow/shared';
import { env } from './env.js';

export type { PresenceStore, PresenceEntry } from '@trackflow/shared';

/** Picks Upstash when configured, else the in-memory store. */
export function createPresenceStore(): PresenceStore {
  if (env.upstashUrl && env.upstashToken) {
    return new UpstashPresenceStore(env.upstashUrl, env.upstashToken);
  }
  return new MemoryPresenceStore();
}
