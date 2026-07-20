import { errors } from '@trackflow/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth.js';
import { createRateLimitStore, type RateLimitStore } from './rate-limit-store.js';

const defaultStore = createRateLimitStore();

interface RateLimitOptions {
  user: number; // per-user limit (JWT principals)
  apiKey: number; // per-API-key limit (programmatic principals)
  windowMs: number;
}

/** Fixed-window limiter. Users are bucketed per user; API keys per key (so each
 *  key gets its own allowance), with a separate, typically higher, limit. The
 *  store is injectable for testing; production uses the shared (Upstash) store. */
/** Per-client-IP limiter for unauthenticated / operator routes (login, password
 *  reset, register, admin) where there's no principal to key on. Throttles
 *  credential stuffing, reset-email spam, and admin-token guessing. */
export function ipRateLimit(opts: { limit: number; windowMs: number }, store: RateLimitStore = defaultStore): MiddlewareHandler {
  return async (c, next) => {
    const ip =
      c.req.header('fly-client-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const now = Date.now();
    const { count, resetAt } = await store.hit(`ip:${ip}`, opts.windowMs);
    c.header('X-RateLimit-Limit', String(opts.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, opts.limit - count)));
    if (count > opts.limit) {
      c.header('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      throw errors.rateLimited();
    }
    await next();
  };
}

export function rateLimit(opts: RateLimitOptions, store: RateLimitStore = defaultStore): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const p = c.get('principal');
    const { id, limit } =
      p.kind === 'user'
        ? { id: `u:${p.userId}`, limit: opts.user }
        : { id: `k:${p.keyId ?? p.tenantId}`, limit: opts.apiKey };

    const now = Date.now();
    const { count, resetAt } = await store.hit(id, opts.windowMs);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > limit) {
      c.header('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
      throw errors.rateLimited();
    }
    await next();
  };
}
