/**
 * Trip rollup job. For each device, reads recent positions, detects trips, and
 * idempotently replaces the trips in that window. Runnable on demand
 * (`pnpm jobs:rollup`) or on a schedule (Cron Triggers / Cloud Run Jobs).
 */
import { pathToFileURL } from 'node:url';
import { detectTrips } from '@trackflow/core';
import { and, asc, devices, eq, gte, positions, trips, withSystem } from '@trackflow/db';
import { rebuildDailyRollups } from './daily-rollup.js';
import { db } from './db.js';

const SINCE_HOURS = Number(process.env.ROLLUP_HOURS ?? 720); // 30 days default for dev

export async function runRollup(): Promise<void> {
  const since = new Date(Date.now() - SINCE_HOURS * 3600 * 1000);
  const fleet = await withSystem(db, (tx) =>
    tx.select({ id: devices.id, tenantId: devices.tenantId, name: devices.name }).from(devices),
  );

  let totalTrips = 0;
  for (const d of fleet) {
    const pts = await withSystem(db, (tx) =>
      tx
        .select({ lat: positions.lat, lon: positions.lon, speedKph: positions.speedKph, fixTime: positions.fixTime })
        .from(positions)
        .where(and(eq(positions.deviceId, d.id), gte(positions.fixTime, since)))
        .orderBy(asc(positions.fixTime)),
    );
    if (pts.length < 2) continue;

    const detected = detectTrips(
      pts.map((p) => ({ lat: p.lat, lng: p.lon, speedKph: p.speedKph, t: p.fixTime.getTime() })),
    );

    await withSystem(db, async (tx) => {
      await tx.delete(trips).where(and(eq(trips.deviceId, d.id), gte(trips.startedAt, since)));
      if (detected.length > 0) {
        await tx
          .insert(trips)
          .values(
            detected.map((t) => ({
              tenantId: d.tenantId,
              deviceId: d.id,
              startedAt: new Date(t.startedAt),
              endedAt: new Date(t.endedAt),
              durationS: t.durationS,
              distanceKm: t.distanceKm,
              avgSpeedKph: t.avgSpeedKph,
              maxSpeedKph: t.maxSpeedKph,
              startLat: t.start.lat,
              startLon: t.start.lng,
              endLat: t.end.lat,
              endLon: t.end.lng,
              pointCount: t.pointCount,
              speedingSamples: t.speedingSamples,
            })),
          )
          .onConflictDoNothing();
      }
    });

    totalTrips += detected.length;
    console.log(`[rollup] ${d.name}: ${detected.length} trips from ${pts.length} positions`);
  }

  // Roll trips up into per-device daily aggregates (aligned to the UTC day that
  // contains `since`, so the boundary day is fully recomputed).
  const windowStart = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  await rebuildDailyRollups(windowStart);

  console.log(`[rollup] done — ${totalTrips} trips across ${fleet.length} devices; daily aggregates rebuilt`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runRollup().then(() => process.exit(0));
}
