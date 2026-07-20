import { env } from './env.js';
import { captureToSentry, parseDsn } from './sentry.js';

// Parsed once at startup; null when SENTRY_DSN is unset (errors are only logged).
const sentryDsn = parseDsn(env.sentryDsn);

/**
 * Error reporting seam. Structured-logs errors with context (greppable in log
 * aggregation) and, when SENTRY_DSN is set, forwards them to Sentry. The Sentry
 * send is fire-and-forget and never breaks the caller.
 */
export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      message: e.message,
      stack: e.stack,
      ...context,
    }),
  );
  void captureToSentry(sentryDsn, e, context);
}
