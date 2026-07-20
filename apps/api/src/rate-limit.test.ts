import { AppError } from '@trackflow/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Principal } from './middleware/auth.js';
import { ipRateLimit, rateLimit } from './middleware/rate-limit.js';
import { MemoryStore } from './middleware/rate-limit-store.js';

describe('MemoryStore', () => {
  it('counts hits within a window and shares the reset time', async () => {
    const s = new MemoryStore();
    const a = await s.hit('x', 1000);
    const b = await s.hit('x', 1000);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(b.resetAt).toBe(a.resetAt);
  });

  it('isolates distinct ids', async () => {
    const s = new MemoryStore();
    await s.hit('a', 1000);
    expect((await s.hit('b', 1000)).count).toBe(1);
  });
});

describe('rateLimit middleware', () => {
  function appFor(principal: Principal) {
    const app = new Hono<AppEnv>();
    app.onError((err, c) => {
      if (err instanceof AppError) return c.json({ error: err.code }, err.status as never);
      throw err;
    });
    app.use('*', async (c, next) => {
      c.set('principal', principal);
      await next();
    });
    app.use('*', rateLimit({ user: 2, apiKey: 3, windowMs: 60_000 }, new MemoryStore()));
    app.get('/', (c) => c.text('ok'));
    return app;
  }

  it('blocks a user after the per-user limit', async () => {
    const app = appFor({ kind: 'user', tenantId: 't1', userId: 'u1' });
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(429);
  });

  it('gives API keys a separate, higher limit, bucketed per key', async () => {
    const app = appFor({ kind: 'apikey', tenantId: 't1', keyId: 'k1' });
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200); // apiKey limit (3) exceeds user limit (2)
    expect((await app.request('/')).status).toBe(429);
  });
});

describe('ipRateLimit', () => {
  function appFor() {
    const app = new Hono();
    app.onError((err, c) => {
      if (err instanceof AppError) return c.json({ error: err.code }, err.status as never);
      throw err;
    });
    app.use('*', ipRateLimit({ limit: 2, windowMs: 60_000 }, new MemoryStore()));
    app.get('/', (c) => c.text('ok'));
    return app;
  }

  it('limits per client IP and keeps distinct IPs independent', async () => {
    const app = appFor();
    const a = { headers: { 'x-forwarded-for': '1.2.3.4' } };
    expect((await app.request('/', a)).status).toBe(200);
    expect((await app.request('/', a)).status).toBe(200);
    expect((await app.request('/', a)).status).toBe(429);
    // a different IP has its own budget
    expect((await app.request('/', { headers: { 'x-forwarded-for': '5.6.7.8' } })).status).toBe(200);
  });
});
