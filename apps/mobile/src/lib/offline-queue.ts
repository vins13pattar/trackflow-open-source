/**
 * Persistent offline queue for position reports.
 *
 * When the device loses connectivity (subway, basement, rural dead zone),
 * `enqueue` stores the report in AsyncStorage; `flush` drains the queue in
 * order by calling the provided `sender`. The queue is bounded — the
 * oldest entry is dropped when the cap is reached so memory + storage
 * don't grow unbounded during a long outage.
 *
 * Why FIFO order matters: trip detection on the server uses chronological
 * fix order to compute distances, so a back-fill that arrives out of order
 * would inflate distance. We drain oldest-first and pause on the first
 * failure so the next attempt re-tries from the same point.
 */

import { type KeyValueStorage, defaultStorage } from './storage';

export interface QueuedReport {
  deviceId: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  course: number;
  timestamp: number;
}

export interface QueueOptions {
  storageKey?: string;
  maxEntries?: number;
}

export type Sender = (r: QueuedReport) => Promise<void>;

const DEFAULT_KEY = 'trackflow.offline-queue.v1';
const DEFAULT_MAX = 2000;

export class OfflineQueue {
  private readonly key: string;
  private readonly max: number;
  private readonly storage: Promise<KeyValueStorage>;

  constructor(storage?: KeyValueStorage, opts: QueueOptions = {}) {
    this.key = opts.storageKey ?? DEFAULT_KEY;
    this.max = opts.maxEntries ?? DEFAULT_MAX;
    this.storage = storage ? Promise.resolve(storage) : defaultStorage();
  }

  async read(): Promise<QueuedReport[]> {
    const store = await this.storage;
    const raw = await store.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as QueuedReport[]) : [];
    } catch {
      // Corrupt JSON — drop the queue rather than hard-crash the app.
      return [];
    }
  }

  private async write(items: QueuedReport[]): Promise<void> {
    const store = await this.storage;
    if (items.length === 0) {
      await store.removeItem(this.key);
      return;
    }
    await store.setItem(this.key, JSON.stringify(items));
  }

  async size(): Promise<number> {
    return (await this.read()).length;
  }

  async clear(): Promise<void> {
    const store = await this.storage;
    await store.removeItem(this.key);
  }

  /** Append a report. Drops the oldest entry once the cap is reached. */
  async enqueue(report: QueuedReport): Promise<void> {
    const items = await this.read();
    items.push(report);
    while (items.length > this.max) items.shift();
    await this.write(items);
  }

  /**
   * Drains the queue oldest-first by calling `sender`. Returns `{ sent,
   * remaining }`. Stops on the first send failure so the next attempt
   * resumes from the same fix.
   */
  async flush(sender: Sender): Promise<{ sent: number; remaining: number }> {
    const items = await this.read();
    if (items.length === 0) return { sent: 0, remaining: 0 };
    let sent = 0;
    try {
      while (items.length > 0) {
        const next = items[0]!;
        await sender(next);
        items.shift();
        sent += 1;
      }
    } catch {
      // Stop on first failure — leave the rest for the next flush.
    }
    await this.write(items);
    return { sent, remaining: items.length };
  }
}
