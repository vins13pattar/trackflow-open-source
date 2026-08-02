import { alertDeliveries, withSystem } from '@trackflow/db';
import type { DeliveryResult } from '@trackflow/notifications';
import { systemDb } from './db.js';

/** Channels worth retrying on failure (console is local; skips/suppressions are terminal). */
export const RETRYABLE_CHANNELS: ReadonlySet<string> = new Set(['email', 'sms', 'whatsapp', 'webhook', 'push']);

const BASE_BACKOFF_MS = Number(process.env.NOTIFY_RETRY_BASE_MS ?? 60_000);

/** Exponential backoff from the attempt number that just completed. */
export function backoffFrom(attempt: number): Date {
  return new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (attempt - 1));
}

function isRetryable(r: DeliveryResult): boolean {
  return r.status === 'failed' && RETRYABLE_CHANNELS.has(r.channel) && r.recipient !== '-' && r.recipient !== 'suppressed';
}

/**
 * Persists one row per dispatch result into the delivery log. Transient
 * failures on retryable channels get a `nextRetryAt` so the retry job picks
 * them up; everything else is terminal. System write (RLS-scoped by tenantId).
 */
export async function recordDeliveries(
  tenantId: string,
  alertId: string,
  subject: string,
  body: string,
  results: DeliveryResult[],
): Promise<void> {
  if (results.length === 0) return;
  const rows = results.map((r) => ({
    tenantId,
    alertId,
    channel: r.channel,
    recipient: r.recipient,
    subject,
    body,
    status: r.status,
    attempt: 1,
    error: r.error ?? null,
    nextRetryAt: isRetryable(r) ? backoffFrom(1) : null,
  }));
  await withSystem(systemDb, 'notification-delivery', (tx) => tx.insert(alertDeliveries).values(rows));
}
