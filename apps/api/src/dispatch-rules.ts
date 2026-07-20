import { and, eq, notificationRoutes, tenantNotificationSettings, withSystem } from '@trackflow/db';
import { db } from './db.js';
import { createRateLimitStore, type RateLimitStore } from './middleware/rate-limit-store.js';

export interface DispatchSettings {
  quietStart: string | null; // 'HH:MM'
  quietEnd: string | null;
  timezone: string;
  throttlePerHour: number;
  criticalBypass: boolean;
}

const DEFAULTS: DispatchSettings = {
  quietStart: null,
  quietEnd: null,
  timezone: 'UTC',
  throttlePerHour: 10,
  criticalBypass: true,
};

/** Resolves dispatch settings for a tenant, falling back to platform defaults. */
export async function getDispatchSettings(tenantId: string): Promise<DispatchSettings> {
  const [row] = await withSystem(db, (tx) =>
    tx.select().from(tenantNotificationSettings).where(eq(tenantNotificationSettings.tenantId, tenantId)),
  );
  if (!row) return DEFAULTS;
  return {
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    timezone: row.timezone,
    throttlePerHour: row.throttlePerHour,
    criticalBypass: row.criticalBypass,
  };
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function localMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

/** True if `now` (in the tenant's timezone) falls inside the quiet-hours
 *  window. Handles midnight-crossing windows (e.g. 22:00 → 07:00). */
export function inQuietHours(s: DispatchSettings, now: Date = new Date()): boolean {
  if (!s.quietStart || !s.quietEnd) return false;
  const cur = localMinutes(now, s.timezone);
  const start = parseHHMM(s.quietStart);
  const end = parseHHMM(s.quietEnd);
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/** Whether an alert of `severity` should be suppressed for quiet hours
 *  (`critical` bypasses when the tenant has criticalBypass on). */
export function suppressedByQuiet(severity: string, s: DispatchSettings, now: Date = new Date()): boolean {
  if (s.criticalBypass && severity === 'critical') return false;
  return inQuietHours(s, now);
}

const defaultThrottleStore = createRateLimitStore();

/** Per (tenant, device, event) throttle. Returns true if the alert can fire
 *  now, false if the per-hour limit has already been reached. */
export async function throttleAllow(
  tenantId: string,
  deviceId: string,
  eventType: string,
  s: DispatchSettings,
  store: RateLimitStore = defaultThrottleStore,
): Promise<boolean> {
  const id = `nt:${tenantId}:${deviceId}:${eventType}`;
  const { count } = await store.hit(id, 60 * 60_000);
  return count <= s.throttlePerHour;
}

/** Per-event channel routing override. Returns the route's channels when a
 *  matching active row exists; otherwise null (caller uses the alert's own
 *  channels). RLS-bypassed (the where-clause already scopes by tenantId). */
export async function resolveEventChannels(tenantId: string, eventType: string): Promise<string[] | null> {
  const [row] = await withSystem(db, (tx) =>
    tx
      .select({ channels: notificationRoutes.channels })
      .from(notificationRoutes)
      .where(and(eq(notificationRoutes.tenantId, tenantId), eq(notificationRoutes.eventType, eventType), eq(notificationRoutes.active, true)))
      .limit(1),
  );
  return row?.channels ?? null;
}
