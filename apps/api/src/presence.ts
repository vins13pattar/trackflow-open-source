/**
 * API-side presence reader. Uses the shared registry (written by ingest) to
 * resolve which instance currently holds a device's socket — so a queued
 * command can report whether it'll be delivered promptly or wait for the
 * device to reconnect.
 *
 * Without a shared (Upstash) store the API and ingest run in separate memory,
 * so lookups return null and callers degrade gracefully (the command still
 * queues and is drained on the device's next connect, as before).
 */
import { MemoryPresenceStore, type PresenceStore, UpstashPresenceStore } from '@trackflow/shared';
import { env } from './env.js';

let store: PresenceStore | null = null;

function presenceStore(): PresenceStore {
  if (!store) {
    store =
      env.upstash.url && env.upstash.token
        ? new UpstashPresenceStore(env.upstash.url, env.upstash.token)
        : new MemoryPresenceStore();
  }
  return store;
}

/** True only when a shared presence store is configured (cross-process reads
 *  are meaningful). In single-instance dev, presence isn't authoritative. */
export function presenceConfigured(): boolean {
  return !!(env.upstash.url && env.upstash.token);
}

/** The instance currently holding a device, or null. Never throws — presence is
 *  advisory, so a store hiccup must not fail the command-queue request. */
export async function lookupPresence(imei: string): Promise<{ instanceId: string } | null> {
  if (!presenceConfigured()) return null;
  try {
    const entry = await presenceStore().lookup(imei);
    return entry ? { instanceId: entry.instanceId } : null;
  } catch {
    return null;
  }
}
