/**
 * Notification retry job. Re-dispatches delivery-log rows that previously failed
 * on a transient error, with exponential backoff, until they succeed or hit the
 * attempt cap (then they're marked 'abandoned'). Runnable on demand
 * (`pnpm jobs:notify-retry`) or on the scheduler.
 */
import { pathToFileURL } from 'node:url';
import { alertDeliveries, and, eq, lte, sql, withSystem } from '@trackflow/db';
import { type Channel, type ChannelName, type Recipients, buildRegistry, dispatch } from '@trackflow/notifications';
import { db } from './db.js';

const MAX_ATTEMPTS = Number(process.env.NOTIFY_MAX_ATTEMPTS ?? 5);
const BASE_BACKOFF_MS = Number(process.env.NOTIFY_RETRY_BASE_MS ?? 60_000);
const BATCH = Number(process.env.NOTIFY_RETRY_BATCH ?? 200);

const registry = buildRegistry({
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM,
  msg91ApiKey: process.env.MSG91_API_KEY,
  smsSender: process.env.SMS_SENDER,
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneId: process.env.WHATSAPP_PHONE_ID,
});

/** Maps a channel + stored recipient back to a single-recipient Recipients. */
function recipientsFor(channel: string, recipient: string): Recipients {
  switch (channel) {
    case 'email':
      return { emails: [recipient] };
    case 'sms':
    case 'whatsapp':
      return { phones: [recipient] };
    case 'push':
      return { pushTokens: [recipient] };
    case 'webhook':
      return { webhookUrl: recipient };
    default:
      return {};
  }
}

export interface RetryResult {
  checked: number;
  sent: number;
  requeued: number;
  abandoned: number;
}

export async function retryDueDeliveries(
  now: Date = new Date(),
  reg: Record<ChannelName, Channel> = registry,
): Promise<RetryResult> {
  const due = await withSystem(db, 'system-job', (tx) =>
    tx
      .select()
      .from(alertDeliveries)
      .where(and(eq(alertDeliveries.status, 'failed'), lte(alertDeliveries.nextRetryAt, now)))
      .limit(BATCH),
  );

  let sent = 0;
  let requeued = 0;
  let abandoned = 0;

  for (const d of due) {
    const attempt = d.attempt + 1;
    const [result] = await dispatch(
      reg,
      [d.channel as ChannelName],
      { alertId: d.alertId, title: d.subject, body: d.body, severity: 'info' },
      recipientsFor(d.channel, d.recipient),
    );
    const ok = result?.status === 'sent';

    if (ok) {
      await withSystem(db, 'system-job', (tx) =>
        tx
          .update(alertDeliveries)
          .set({ status: 'sent', attempt, error: null, nextRetryAt: null, updatedAt: sql`now()` })
          .where(eq(alertDeliveries.id, d.id)),
      );
      sent += 1;
    } else if (attempt >= MAX_ATTEMPTS) {
      await withSystem(db, 'system-job', (tx) =>
        tx
          .update(alertDeliveries)
          .set({ status: 'abandoned', attempt, error: result?.error ?? 'max attempts reached', nextRetryAt: null, updatedAt: sql`now()` })
          .where(eq(alertDeliveries.id, d.id)),
      );
      abandoned += 1;
    } else {
      const nextRetryAt = new Date(now.getTime() + BASE_BACKOFF_MS * 2 ** (attempt - 1));
      await withSystem(db, 'system-job', (tx) =>
        tx
          .update(alertDeliveries)
          .set({ status: 'failed', attempt, error: result?.error ?? 'retry failed', nextRetryAt, updatedAt: sql`now()` })
          .where(eq(alertDeliveries.id, d.id)),
      );
      requeued += 1;
    }
  }

  console.log(`[notify-retry] checked ${due.length} — sent ${sent}, requeued ${requeued}, abandoned ${abandoned}`);
  return { checked: due.length, sent, requeued, abandoned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void retryDueDeliveries().then(() => process.exit(0));
}
