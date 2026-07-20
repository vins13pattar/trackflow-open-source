/**
 * Device presence registry — shared by ingest (the writer: binds a device to
 * its instance on connect) and the API (the reader: resolves which instance
 * currently holds a device, e.g. to route a queued command toward it).
 *
 * Config is passed to the constructors (no env access here), so each app wires
 * it from its own environment. In-memory is correct for a single instance;
 * Upstash Redis (REST) is the shared store across instances. Keys carry a TTL
 * so a crashed instance's bindings self-expire rather than pinning a device to
 * a dead pod.
 */

export interface PresenceEntry {
  instanceId: string;
  lastSeen: number;
}

export interface PresenceStore {
  /** Bind (or refresh) a device to this instance. */
  online(imei: string, instanceId: string): Promise<void>;
  /** Release a device — but only if this instance still owns the binding, so a
   *  late close from an old socket can't evict a newer connection elsewhere. */
  offline(imei: string, instanceId: string): Promise<void>;
  /** Which instance currently holds the device, if any (null once expired). */
  lookup(imei: string): Promise<PresenceEntry | null>;
}

/** Idle TTL after which a binding is considered stale (refreshed on activity). */
export const PRESENCE_TTL_MS = 5 * 60 * 1000;

/** In-memory presence — correct for a single instance; lookups for other
 *  instances simply miss (there are none). */
export class MemoryPresenceStore implements PresenceStore {
  private readonly map = new Map<string, PresenceEntry>();

  constructor(private readonly ttlMs: number = PRESENCE_TTL_MS) {}

  async online(imei: string, instanceId: string): Promise<void> {
    this.map.set(imei, { instanceId, lastSeen: Date.now() });
  }

  async offline(imei: string, instanceId: string): Promise<void> {
    const cur = this.map.get(imei);
    if (cur && cur.instanceId === instanceId) this.map.delete(imei);
  }

  async lookup(imei: string): Promise<PresenceEntry | null> {
    const cur = this.map.get(imei);
    if (!cur) return null;
    if (Date.now() - cur.lastSeen > this.ttlMs) {
      this.map.delete(imei);
      return null;
    }
    return cur;
  }
}

/** Shared presence backed by Upstash Redis (REST). `online` writes the holder
 *  with a TTL (SET PX); `offline` deletes only when this instance still owns the
 *  key (GET then conditional DEL); `lookup` reads the holder. */
export class UpstashPresenceStore implements PresenceStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly ttlMs: number = PRESENCE_TTL_MS,
  ) {}

  private key(imei: string): string {
    return `presence:${imei}`;
  }

  private async cmd<T>(command: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`Upstash presence store error: ${res.status}`);
    return ((await res.json()) as { result: T }).result;
  }

  async online(imei: string, instanceId: string): Promise<void> {
    await this.cmd(['SET', this.key(imei), instanceId, 'PX', String(this.ttlMs)]);
  }

  async offline(imei: string, instanceId: string): Promise<void> {
    const cur = await this.cmd<string | null>(['GET', this.key(imei)]);
    if (cur === instanceId) await this.cmd(['DEL', this.key(imei)]);
  }

  async lookup(imei: string): Promise<PresenceEntry | null> {
    const instanceId = await this.cmd<string | null>(['GET', this.key(imei)]);
    return instanceId ? { instanceId, lastSeen: Date.now() } : null;
  }
}
