/**
 * Browser error reporting — the web counterpart to the API/ingest Sentry
 * transport. Deliberately a tiny, dependency-free fetch POST rather than
 * @sentry/nextjs, matching the architectural decision in the rest of the repo
 * (no heavy SDK; DSN-gated so it is a no-op without configuration).
 *
 * Reads NEXT_PUBLIC_SENTRY_DSN (a public key DSN is safe to ship to the client).
 */

interface SentryDsn {
  protocol: string;
  host: string;
  projectId: string;
  publicKey: string;
}

function parseDsn(dsn: string | undefined): SentryDsn | null {
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

const dsn = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

function eventId(): string {
  // crypto.randomUUID exists in all browsers we target; fall back just in case.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '');
  return Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
}

/** Fire-and-forget capture. No-op without a DSN; never throws into the caller. */
export function reportError(err: Error, context: Record<string, unknown> = {}): void {
  if (!dsn) return;
  const event = {
    event_id: eventId(),
    timestamp: new Date().toISOString(),
    platform: 'javascript',
    level: 'error',
    logger: 'trackflow-web',
    exception: { values: [{ type: err.name, value: err.message }] },
    extra: {
      ...context,
      stack: err.stack,
      ...(typeof window !== 'undefined' ? { url: window.location.href, userAgent: navigator.userAgent } : {}),
    },
  };
  try {
    void fetch(`${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sentry-auth': `Sentry sentry_version=7, sentry_client=trackflow-web/1.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(event),
      keepalive: true, // let the report survive a navigation/unload
    }).catch(() => {});
  } catch {
    // Telemetry must never break the UI.
  }
}

export { parseDsn, type SentryDsn };
