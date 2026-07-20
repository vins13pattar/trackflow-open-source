/**
 * Minimal, dependency-free Sentry error transport. Posts a single event to
 * Sentry's store endpoint when a DSN is configured — enough to capture errors
 * with context, without the weight (and OpenTelemetry init-ordering) of the
 * full @sentry/node SDK. Swap in the SDK later if richer tracing is wanted.
 *
 * Lives in shared so the API, ingest and jobs processes all report through
 * the same transport (Web-Crypto only — edge-portable like the rest of shared).
 */
export interface SentryDsn {
  protocol: string;
  host: string;
  projectId: string;
  publicKey: string;
}

/** Parses a Sentry DSN (`https://<publicKey>@<host>/<projectId>`); null if absent/invalid. */
export function parseDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) return null;
    return { protocol: u.protocol.replace(':', ''), host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

/** Fire-and-forget capture. No-op without a DSN; never throws into the caller. */
export async function captureToSentry(
  dsn: SentryDsn | null,
  err: Error,
  context: Record<string, unknown> = {},
  logger = 'trackflow',
): Promise<void> {
  if (!dsn) return;
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    logger,
    exception: { values: [{ type: err.name, value: err.message }] },
    extra: { ...context, stack: err.stack },
  };
  try {
    await fetch(`${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=trackflow/1.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Telemetry must never break the caller's path.
  }
}
