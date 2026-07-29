/**
 * Ingest-side presence factory. The store implementations live in
 * `@trackflow/shared` (so the API can read the same registry); this picks the
 * shared Upstash store when configured, else the in-memory one.
 */
import {
  MemoryPresenceStore,
  type PresenceStore,
  RedisPresenceStore,
  type RedisPresenceClient,
  UpstashPresenceStore,
} from '@trackflow/shared';
import { env } from './env.js';
import { redisClient } from './redis.js';

export type { PresenceStore, PresenceEntry } from '@trackflow/shared';

/** Picks Upstash when configured, else the in-memory store. */
export function createPresenceStore(): PresenceStore {
  if (env.redisUrl) {
    return new RedisPresenceStore({
      get: async (key) => (await redisClient(env.redisUrl!)).get(key),
      set: async (key, value, options) => (await redisClient(env.redisUrl!)).set(key, value, options),
      eval: async (script, options) => (await redisClient(env.redisUrl!)).eval(script, options),
    } satisfies RedisPresenceClient);
  }
  if (env.upstashUrl && env.upstashToken) {
    return new UpstashPresenceStore(env.upstashUrl, env.upstashToken);
  }
  return new MemoryPresenceStore();
}
