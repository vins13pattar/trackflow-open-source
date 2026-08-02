import { dailyRollups, devices, eq, tenants, trips, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rebuildDailyRollups } from './daily-rollup.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('daily rollups', () => {
  let tenantId: string;
  let deviceId: string;
  // Two fixed UTC days in the past, so they never collide with "now".
  const dayA = '2025-01-10';
  const dayB = '2025-01-11';
  const windowStart = new Date('2025-01-01T00:00:00.000Z');

  function trip(day: string, hour: number, distanceKm: number, maxSpeedKph: number, speeding: number) {
    const startedAt = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);
    return {
      tenantId,
      deviceId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + 30 * 60 * 1000),
      durationS: 1800,
      distanceKm,
      avgSpeedKph: distanceKm / 0.5,
      maxSpeedKph,
      pointCount: 60,
      speedingSamples: speeding,
    };
  }

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Rollup', slug: `rollup-${Math.random().toString(36).slice(2, 10)}` })
      .returning();
    tenantId = t!.id;
    // devices/trips are RLS-protected; jobs bypass RLS via withSystem.
    await withSystem(db, 'test-fixture', async (tx) => {
      const [d] = await tx
        .insert(devices)
        .values({ tenantId, name: 'Dev', imei: `imei-${Math.random().toString(36).slice(2, 12)}` })
        .returning();
      deviceId = d!.id;
      await tx.insert(trips).values([trip(dayA, 8, 10, 80, 2), trip(dayA, 12, 5, 60, 0), trip(dayB, 9, 20, 100, 5)]);
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const rollups = () =>
    withSystem(db, 'test-fixture', (tx) => tx.select().from(dailyRollups).where(eq(dailyRollups.deviceId, deviceId)).orderBy(dailyRollups.day));

  it('aggregates trips into one row per device-day', async () => {
    await rebuildDailyRollups(windowStart);
    const rows = await rollups();
    expect(rows.map((r) => r.day)).toEqual([dayA, dayB]);

    const a = rows.find((r) => r.day === dayA)!;
    expect(a.trips).toBe(2);
    expect(a.distanceKm).toBeCloseTo(15);
    expect(a.maxSpeedKph).toBeCloseTo(80);
    expect(a.speedingSamples).toBe(2);

    const b = rows.find((r) => r.day === dayB)!;
    expect(b.trips).toBe(1);
    expect(b.distanceKm).toBeCloseTo(20);
  });

  it('upserts on re-run: no duplicate rows, and new trips are folded in', async () => {
    await rebuildDailyRollups(windowStart);
    expect(await rollups()).toHaveLength(2);

    await withSystem(db, 'test-fixture', (tx) => tx.insert(trips).values([trip(dayA, 18, 7, 90, 1)]));
    await rebuildDailyRollups(windowStart);

    const rows = await rollups();
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.day === dayA)!;
    expect(a.trips).toBe(3);
    expect(a.distanceKm).toBeCloseTo(22);
    expect(a.maxSpeedKph).toBeCloseTo(90);
  });
});
