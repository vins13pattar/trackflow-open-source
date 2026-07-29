import { env } from '../env.js';
import { redisClient } from '../redis.js';

export interface RateLimitResult {
  count: number;
  resetAt: number;
}

/** A fixed-window counter store. The in-memory impl serves dev/single-instance;
 *  the Upstash impl is shared across instances (production). */
export interface RateLimitStore {
  hit(id: string, windowMs: number): Promise<RateLimitResult>;
}

/** In-memory fixed-window limiter — fine for a single instance. */
export class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitResult>();

  async hit(id: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(id, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }
}

/** Shared fixed-window limiter backed by Upstash Redis (REST). INCR counts the
 *  hit; PEXPIRE..NX sets the window TTL only on the first hit; PTTL reports the
 *  remaining window so callers can compute resetAt. */
export class UpstashStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async hit(id: string, windowMs: number): Promise<RateLimitResult> {
    const key = `rl:${id}`;
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['PEXPIRE', key, String(windowMs), 'NX'],
        ['PTTL', key],
      ]),
    });
    if (!res.ok) throw new Error(`Upstash rate-limit store error: ${res.status}`);
    const out = (await res.json()) as Array<{ result: number }>;
    const count = out[0]!.result;
    const ttl = out[2]!.result;
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
  }
}

const RATE_LIMIT_SCRIPT =
  "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local ttl=redis.call('PTTL',KEYS[1]); return {count,ttl}";

/** Fixed-window limiter over the standard Redis protocol. */
export class RedisStore implements RateLimitStore {
  constructor(private readonly url: string) {}

  async hit(id: string, windowMs: number): Promise<RateLimitResult> {
    const client = await redisClient(this.url);
    const result = (await client.eval(RATE_LIMIT_SCRIPT, {
      keys: [`rl:${id}`],
      arguments: [String(windowMs)],
    })) as [number, number];
    const [count, ttl] = result;
    return { count, resetAt: Date.now() + (ttl > 0 ? ttl : windowMs) };
  }
}

/** Picks standard Redis first, then the legacy REST adapter, then memory. */
export function createRateLimitStore(): RateLimitStore {
  if (env.redisUrl) return new RedisStore(env.redisUrl);
  if (env.upstash.url && env.upstash.token) return new UpstashStore(env.upstash.url, env.upstash.token);
  return new MemoryStore();
}
