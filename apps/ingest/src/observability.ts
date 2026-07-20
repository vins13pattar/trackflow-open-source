import { captureToSentry, parseDsn } from '@trackflow/shared';

/**
 * DSN-gated error reporting for the always-on ingest process (the one piece
 * whose silent death loses data). No-op without SENTRY_DSN, mirroring the API.
 */
const dsn = parseDsn(process.env.SENTRY_DSN);

export function reportIngestError(err: Error, context: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      message: err.message,
      stack: err.stack,
      ...context,
    }),
  );
  void captureToSentry(dsn, err, context, 'trackflow-ingest');
}

export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  reportIngestError(err instanceof Error ? err : new Error(String(err)), context);
}

/** Last-resort handlers: report, then let the process die so the supervisor
 *  restarts it cleanly — a half-alive ingest is worse than a restart. */
export function installProcessHandlers(): void {
  process.on('uncaughtException', (err) => {
    reportIngestError(err, { where: 'uncaughtException' });
    setTimeout(() => process.exit(1), 500).unref();
  });
  process.on('unhandledRejection', (reason) => {
    reportIngestError(reason instanceof Error ? reason : new Error(String(reason)), {
      where: 'unhandledRejection',
    });
  });
}
