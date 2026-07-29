/**
 * Cross-pod IMEI binding store for multi-instance ingest.
 *
 * The problem: a GPS device opens a TCP socket, "logs in" with its IMEI on
 * the first frame, then sends periodic position frames over the same
 * connection. Some protocols (e.g. GT06) only send the IMEI in the login
 * frame — subsequent frames carry the IMEI implicitly via the connection.
 *
 * In a single-instance world we keep a `SessionContext` per socket and bind
 * the IMEI to it on login. Fine. But if the device reconnects to a
 * *different* pod (load-balanced TCP), the new pod sees a connection with
 * no IMEI in its in-memory map.
 *
 * This store gives us:
 *   - `bindImei(connectionKey, imei)` — record the binding when seen
 *   - `lookupImei(connectionKey)` — read it back on the next pod
 *   - `bindRoute(imei, podId)` — track which pod a device's session lives on
 *     (used by an upstream NLB / sticky-session router)
 *
 * Backed by Upstash Redis (REST API — works from Workers and Node) when
 * `INGEST_REDIS_URL` + `INGEST_REDIS_TOKEN` are set; otherwise the store
 * degrades to an in-memory Map so single-instance dev keeps working without
 * Redis. TTL on every entry (default 6h) so dead sessions get reaped.
 */

export interface SessionStore {
  bindImei(connectionKey: string, imei: string): Promise<void>;
  lookupImei(connectionKey: string): Promise<string | null>;
  bindRoute(imei: string, podId: string): Promise<void>;
  lookupRoute(imei: string): Promise<string | null>;
  forget(connectionKey: string): Promise<void>;
}

export interface RedisSessionClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
}

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

class InMemorySessionStore implements SessionStore {
  private readonly conn = new Map<string, { imei: string; expiresAt: number }>();
  private readonly route = new Map<string, { podId: string; expiresAt: number }>();

  constructor(private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS) {}

  private expired(at: number): boolean {
    return Date.now() > at;
  }

  async bindImei(connectionKey: string, imei: string): Promise<void> {
    this.conn.set(connectionKey, { imei, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async lookupImei(connectionKey: string): Promise<string | null> {
    const row = this.conn.get(connectionKey);
    if (!row) return null;
    if (this.expired(row.expiresAt)) {
      this.conn.delete(connectionKey);
      return null;
    }
    return row.imei;
  }

  async bindRoute(imei: string, podId: string): Promise<void> {
    this.route.set(imei, { podId, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async lookupRoute(imei: string): Promise<string | null> {
    const row = this.route.get(imei);
    if (!row) return null;
    if (this.expired(row.expiresAt)) {
      this.route.delete(imei);
      return null;
    }
    return row.podId;
  }

  async forget(connectionKey: string): Promise<void> {
    this.conn.delete(connectionKey);
  }
}

/** Upstash REST API client — works without the Upstash SDK. */
class UpstashRedisStore implements SessionStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async cmd(parts: (string | number)[]): Promise<unknown> {
    const res = await this.fetchImpl(`${this.url}/${parts.map((p) => encodeURIComponent(String(p))).join('/')}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`Upstash ${parts[0]} failed: ${res.status}`);
    const body = (await res.json()) as { result?: unknown };
    return body.result;
  }

  private connKey(connectionKey: string): string {
    return `tf:ingest:conn:${connectionKey}`;
  }
  private routeKey(imei: string): string {
    return `tf:ingest:route:${imei}`;
  }

  async bindImei(connectionKey: string, imei: string): Promise<void> {
    await this.cmd(['set', this.connKey(connectionKey), imei, 'ex', this.ttlSeconds]);
  }

  async lookupImei(connectionKey: string): Promise<string | null> {
    const r = await this.cmd(['get', this.connKey(connectionKey)]);
    return typeof r === 'string' ? r : null;
  }

  async bindRoute(imei: string, podId: string): Promise<void> {
    await this.cmd(['set', this.routeKey(imei), podId, 'ex', this.ttlSeconds]);
  }

  async lookupRoute(imei: string): Promise<string | null> {
    const r = await this.cmd(['get', this.routeKey(imei)]);
    return typeof r === 'string' ? r : null;
  }

  async forget(connectionKey: string): Promise<void> {
    await this.cmd(['del', this.connKey(connectionKey)]);
  }
}

class StandardRedisStore implements SessionStore {
  constructor(
    private readonly client: RedisSessionClient,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ) {}

  private connKey(connectionKey: string): string {
    return `tf:ingest:conn:${connectionKey}`;
  }
  private routeKey(imei: string): string {
    return `tf:ingest:route:${imei}`;
  }

  async bindImei(connectionKey: string, imei: string): Promise<void> {
    await this.client.set(this.connKey(connectionKey), imei, { EX: this.ttlSeconds });
  }
  async lookupImei(connectionKey: string): Promise<string | null> {
    return this.client.get(this.connKey(connectionKey));
  }
  async bindRoute(imei: string, podId: string): Promise<void> {
    await this.client.set(this.routeKey(imei), podId, { EX: this.ttlSeconds });
  }
  async lookupRoute(imei: string): Promise<string | null> {
    return this.client.get(this.routeKey(imei));
  }
  async forget(connectionKey: string): Promise<void> {
    await this.client.del(this.connKey(connectionKey));
  }
}

let cached: SessionStore | null = null;

/**
 * Returns the configured store, or an in-memory fallback when Redis env vars
 * are absent. The same instance is reused across calls.
 */
export function getSessionStore(): SessionStore {
  if (cached) return cached;
  const standardUrl = process.env.REDIS_URL;
  const url = process.env.INGEST_REDIS_URL;
  const token = process.env.INGEST_REDIS_TOKEN;
  const ttl = process.env.INGEST_SESSION_TTL_SEC ? Number(process.env.INGEST_SESSION_TTL_SEC) : DEFAULT_TTL_SECONDS;
  if (standardUrl) {
    cached = new StandardRedisStore(
      {
        get: async (key) => (await import('./redis.js')).redisClient(standardUrl).then((client) => client.get(key)),
        set: async (key, value, options) =>
          (await import('./redis.js')).redisClient(standardUrl).then((client) => client.set(key, value, options)),
        del: async (key) => (await import('./redis.js')).redisClient(standardUrl).then((client) => client.del(key)),
      },
      ttl,
    );
  } else {
    cached = url && token ? new UpstashRedisStore(url, token, ttl) : new InMemorySessionStore(ttl);
  }
  return cached;
}

/** Internal helpers exposed for tests. */
export const __test = { InMemorySessionStore, StandardRedisStore, UpstashRedisStore };

/** Reset the cached singleton — only for tests. */
export function __resetSessionStore(): void {
  cached = null;
}
