import { and, dailyRollups, gte, lte, sql, trips, withTenant } from '@trackflow/db';
import { Hono } from 'hono';
import { db } from '../db.js';
import type { AppEnv } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';

export const analyticsRoutes = new Hono<AppEnv>();

analyticsRoutes.use('*', requirePermission('reports:read'));

function range(c: { req: { query: (k: string) => string | undefined } }): { from: Date; to: Date } {
  const now = Date.now();
  return {
    from: new Date(Number(c.req.query('from') ?? now - 7 * 24 * 3600 * 1000)),
    to: new Date(Number(c.req.query('to') ?? now)),
  };
}

/** Range queries hit the per-day rollup, so cost scales with days in range
 *  rather than trips. The rollup `day` column is a UTC calendar date. */
function dayRange(from: Date, to: Date): { fromDay: string; toDay: string } {
  return { fromDay: from.toISOString().slice(0, 10), toDay: to.toISOString().slice(0, 10) };
}

analyticsRoutes.get('/summary', async (c) => {
  const { tenantId } = c.get('principal');
  const { from, to } = range(c);
  const { fromDay, toDay } = dayRange(from, to);
  const [agg] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        trips: sql<string>`coalesce(sum(${dailyRollups.trips}), 0)`,
        distanceKm: sql<string>`coalesce(sum(${dailyRollups.distanceKm}), 0)`,
        durationS: sql<string>`coalesce(sum(${dailyRollups.durationS}), 0)`,
        maxSpeed: sql<string>`coalesce(max(${dailyRollups.maxSpeedKph}), 0)`,
        speeding: sql<string>`coalesce(sum(${dailyRollups.speedingSamples}), 0)`,
        activeDevices: sql<string>`count(distinct ${dailyRollups.deviceId})`,
      })
      .from(dailyRollups)
      .where(and(gte(dailyRollups.day, fromDay), lte(dailyRollups.day, toDay))),
  );

  const tripCount = Number(agg?.trips ?? 0);
  const speeding = Number(agg?.speeding ?? 0);
  const distanceKm = Number(agg?.distanceKm ?? 0);
  const durationS = Number(agg?.durationS ?? 0);
  const driverScore = Math.max(0, Math.round(100 - (tripCount ? (speeding / tripCount) * 5 : 0)));
  // Fleet average derived from totals (distance / moving time).
  const avgSpeedKph = durationS > 0 ? distanceKm / (durationS / 3600) : 0;

  return c.json({
    trips: tripCount,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationHours: Math.round((durationS / 3600) * 10) / 10,
    avgSpeedKph: Math.round(avgSpeedKph * 10) / 10,
    maxSpeedKph: Math.round(Number(agg?.maxSpeed ?? 0)),
    activeDevices: Number(agg?.activeDevices ?? 0),
    driverScore,
  });
});

analyticsRoutes.get('/distance-by-day', async (c) => {
  const { tenantId } = c.get('principal');
  const { from, to } = range(c);
  const { fromDay, toDay } = dayRange(from, to);
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        day: dailyRollups.day,
        distanceKm: sql<string>`coalesce(sum(${dailyRollups.distanceKm}), 0)`,
        trips: sql<string>`coalesce(sum(${dailyRollups.trips}), 0)`,
      })
      .from(dailyRollups)
      .where(and(gte(dailyRollups.day, fromDay), lte(dailyRollups.day, toDay)))
      .groupBy(dailyRollups.day)
      .orderBy(dailyRollups.day),
  );
  return c.json({
    days: rows.map((r) => ({
      date: r.day,
      distanceKm: Math.round(Number(r.distanceKm) * 100) / 100,
      trips: Number(r.trips),
    })),
  });
});

analyticsRoutes.get('/export', async (c) => {
  const { tenantId } = c.get('principal');
  const { from, to } = range(c);
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(trips)
      .where(and(gte(trips.startedAt, from), lte(trips.startedAt, to)))
      .orderBy(trips.startedAt),
  );
  const header = 'device_id,started_at,ended_at,distance_km,duration_s,avg_speed_kph,max_speed_kph,speeding_samples';
  const csv = [
    header,
    ...rows.map((t) =>
      [
        t.deviceId,
        t.startedAt.toISOString(),
        t.endedAt.toISOString(),
        t.distanceKm.toFixed(2),
        t.durationS,
        t.avgSpeedKph.toFixed(1),
        t.maxSpeedKph.toFixed(1),
        t.speedingSamples,
      ].join(','),
    ),
  ].join('\n');
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', 'attachment; filename="trips.csv"');
  return c.body(csv);
});
