/**
 * Ingest-downtime watchdog. Ingest is the always-on dependency: every device
 * write bumps `devices.last_seen`, so the freshest `last_seen` across the fleet
 * is a proxy for "is ingest flowing?". If the newest write is older than the
 * stale threshold while active devices exist, ingest is likely down and we
 * dispatch an alert. Runs on the scheduler (or `pnpm jobs:ingest-health`).
 */
import { pathToFileURL } from 'node:url';
import { devices, eq, sql, withSystem } from '@trackflow/db';
import { buildRegistry, dispatch } from '@trackflow/notifications';
import { db } from './db.js';

const STALE_MS = Number(process.env.INGEST_STALE_MS ?? 5 * 60_000);
const ALERT_EMAIL = process.env.INGEST_ALERT_EMAIL;

export interface IngestHealth {
  healthy: boolean;
  latestSeen: Date | null;
  ageSeconds: number | null;
  activeDevices: number;
}

/** Computes ingest freshness. Scope to a tenant with `tenantId`; omit it for the
 *  system-wide check. Healthy when there are no active devices (nothing expected)
 *  or the most recent write is within `staleMs`. */
export async function checkIngestHealth(opts: { staleMs?: number; tenantId?: string } = {}): Promise<IngestHealth> {
  const staleMs = opts.staleMs ?? STALE_MS;
  return withSystem(db, 'system-job', async (tx) => {
    const [row] = await tx
      .select({
        latest: sql<string | null>`max(${devices.lastSeen})`,
        active: sql<string>`count(*) filter (where ${devices.status} = 'active')`,
      })
      .from(devices)
      .where(opts.tenantId ? eq(devices.tenantId, opts.tenantId) : undefined);

    const activeDevices = Number(row?.active ?? 0);
    const latestSeen = row?.latest ? new Date(row.latest) : null;
    const ageSeconds = latestSeen ? Math.floor((Date.now() - latestSeen.getTime()) / 1000) : null;
    const healthy = activeDevices === 0 || (ageSeconds !== null && ageSeconds * 1000 <= staleMs);
    return { healthy, latestSeen, ageSeconds, activeDevices };
  });
}

/** Runs the check and, when unhealthy, dispatches a downtime alert. Returns the
 *  health snapshot. `opts` is forwarded to the check (used by tests to scope). */
export async function runIngestHealthCheck(opts: { staleMs?: number; tenantId?: string } = {}): Promise<IngestHealth> {
  const health = await checkIngestHealth(opts);
  if (health.healthy) {
    console.log(`[ingest-health] ok — latest write ${health.ageSeconds ?? 'n/a'}s ago, ${health.activeDevices} active device(s)`);
    return health;
  }

  console.warn(`[ingest-health] DOWN — no ingest for ${health.ageSeconds ?? 'ever'}s across ${health.activeDevices} active device(s)`);
  const registry = buildRegistry({ resendApiKey: process.env.RESEND_API_KEY, emailFrom: process.env.EMAIL_FROM });
  await dispatch(
    registry,
    ALERT_EMAIL ? ['console', 'email'] : ['console'],
    {
      alertId: 'ingest-downtime',
      title: 'TrackFlow ingest appears to be down',
      body: `No position ingest for ${health.ageSeconds ?? 'an unknown time'}s (latest ${health.latestSeen?.toISOString() ?? 'never'}). ${health.activeDevices} active device(s) expected to report.`,
      severity: 'critical',
    },
    { emails: ALERT_EMAIL ? [ALERT_EMAIL] : [] },
  );
  return health;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runIngestHealthCheck().then((h) => process.exit(h.healthy ? 0 : 1));
}
