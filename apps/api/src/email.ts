import { channelRegistry } from './notifications.js';

/**
 * Sends a transactional email via the configured provider (Resend). With no key
 * set (local/dev) the email channel reports "skipped" rather than sending —
 * flows still complete; only delivery is a no-op.
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  await channelRegistry.email.send({ alertId: '', title: subject, body, severity: 'info' }, { emails: [to] });
}
