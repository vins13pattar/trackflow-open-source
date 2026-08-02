/**
 * Daily rollup builder. Recomputes per-device, per-day aggregates from `trips`
 * for every day touched by the window [windowStart, now]. Idempotent: upserts on
 * (device_id, day), so re-running over an overlapping window is safe.
 */
import { sql, withSystem } from '@trackflow/db';
import { db } from './db.js';

export async function rebuildDailyRollups(windowStart: Date): Promise<void> {
  await withSystem(db, 'system-job', (tx) =>
    tx.execute(sql`
      INSERT INTO daily_rollups
        (tenant_id, device_id, day, trips, distance_km, duration_s, max_speed_kph, speeding_samples, point_count, updated_at)
      SELECT
        tenant_id,
        device_id,
        (started_at AT TIME ZONE 'UTC')::date AS day,
        count(*)::int,
        coalesce(sum(distance_km), 0),
        coalesce(sum(duration_s), 0)::int,
        coalesce(max(max_speed_kph), 0),
        coalesce(sum(speeding_samples), 0)::int,
        coalesce(sum(point_count), 0)::int,
        now()
      FROM trips
      WHERE started_at >= ${windowStart.toISOString()}::timestamptz
      GROUP BY tenant_id, device_id, (started_at AT TIME ZONE 'UTC')::date
      ON CONFLICT (device_id, day) DO UPDATE SET
        trips = EXCLUDED.trips,
        distance_km = EXCLUDED.distance_km,
        duration_s = EXCLUDED.duration_s,
        max_speed_kph = EXCLUDED.max_speed_kph,
        speeding_samples = EXCLUDED.speeding_samples,
        point_count = EXCLUDED.point_count,
        updated_at = now()
    `),
  );
}
