/** The shared dependency-free Sentry transport, pinned to this app's logger name. */
import { captureToSentry as capture, type SentryDsn } from '@trackflow/shared';

export { parseDsn, type SentryDsn } from '@trackflow/shared';

export async function captureToSentry(
  dsn: SentryDsn | null,
  err: Error,
  context: Record<string, unknown> = {},
): Promise<void> {
  return capture(dsn, err, context, 'trackflow-api');
}
