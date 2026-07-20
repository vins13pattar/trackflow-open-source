import { and, eq, sql, type Webhook, webhookDeliveries, webhooks, withSystem } from '@trackflow/db';
import { db } from './db.js';
import { hmacHex } from './hmac.js';

export interface DeliveryOutcome {
  ok: boolean;
  status?: number;
  error?: string;
  attempts: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function logAttempt(
  hook: Webhook,
  event: string,
  attempt: number,
  result: { status: 'sent' | 'failed'; httpStatus?: number; error?: string; durationMs: number },
): Promise<void> {
  try {
    await withSystem(db, (tx) =>
      tx.insert(webhookDeliveries).values({
        tenantId: hook.tenantId,
        webhookId: hook.id,
        event,
        attempt,
        status: result.status,
        httpStatus: result.httpStatus ?? null,
        error: result.error ?? null,
        durationMs: result.durationMs,
      }),
    );
  } catch (err) {
    console.warn('[webhooks] failed to persist delivery log:', (err as Error).message);
  }
}

/** Delivers one event to one webhook with HMAC signing, exponential backoff,
 *  and a per-attempt log row. */
export async function deliverOne(hook: Webhook, event: string, data: unknown): Promise<DeliveryOutcome> {
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
  const signature = `sha256=${await hmacHex(hook.secret, body)}`;
  const deliveryId = crypto.randomUUID();
  let lastError = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await sleep(200 * 2 ** (attempt - 1));
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(
        hook.url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-trackflow-event': event,
            'x-trackflow-signature': signature,
            'x-trackflow-delivery': deliveryId,
          },
          body,
        },
        10_000,
      );
      const durationMs = Date.now() - startedAt;
      if (res.ok) {
        await logAttempt(hook, event, attempt, { status: 'sent', httpStatus: res.status, durationMs });
        await withSystem(db, (tx) =>
          tx
            .update(webhooks)
            .set({ successCount: sql`${webhooks.successCount} + 1`, lastSuccessAt: sql`now()`, lastError: null })
            .where(eq(webhooks.id, hook.id)),
        );
        return { ok: true, status: res.status, attempts: attempt };
      }
      lastStatus = res.status;
      lastError = `HTTP ${res.status}`;
      await logAttempt(hook, event, attempt, { status: 'failed', httpStatus: res.status, error: lastError, durationMs });
    } catch (err) {
      lastError = (err as Error).message;
      await logAttempt(hook, event, attempt, { status: 'failed', error: lastError, durationMs: Date.now() - startedAt });
    }
  }

  await withSystem(db, (tx) =>
    tx
      .update(webhooks)
      .set({ failureCount: sql`${webhooks.failureCount} + 1`, lastFailureAt: sql`now()`, lastError })
      .where(eq(webhooks.id, hook.id)),
  );
  return { ok: false, status: lastStatus, error: lastError, attempts: 3 };
}

/** Per-device filter: empty deviceIds = all devices; otherwise the event's
 *  `deviceId` (when present in the payload) must be in the allow-list. Events
 *  without a deviceId always pass (e.g., tenant-wide events). */
function matchesDeviceFilter(hook: Webhook, data: unknown): boolean {
  if (hook.deviceIds.length === 0) return true;
  const deviceId = (data as { deviceId?: string } | undefined)?.deviceId;
  return deviceId == null || hook.deviceIds.includes(deviceId);
}

/** Fans an event out to all of a tenant's active webhooks subscribed to it
 *  (and not filtered out by the per-device allow-list). */
export async function deliverEvent(tenantId: string, event: string, data: unknown): Promise<void> {
  const hooks = await withSystem(db, (tx) =>
    tx.select().from(webhooks).where(and(eq(webhooks.tenantId, tenantId), eq(webhooks.status, 'active'))),
  );
  const subscribed = hooks.filter((h) => h.events.includes(event) && matchesDeviceFilter(h, data));
  await Promise.all(subscribed.map((h) => deliverOne(h, event, data)));
}
