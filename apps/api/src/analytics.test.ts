import { dailyRollups, devices, eq, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('analytics reads daily rollups', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  // Range covering the two seeded rollup days (epoch ms for the query params).
  const from = Date.UTC(2025, 1, 1); // 2025-02-01
  const to = Date.UTC(2025, 1, 3); // 2025-02-03

  beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `an-${stamp}@example.com`, password: 'password123', name: 'Owner', tenantName: `Org ${stamp}` }),
    });
    const body = (await res.json()) as { user: { tenantId: string }; tokens: { accessToken: string } };
    tenantId = body.user.tenantId;
    token = body.tokens.accessToken;

    await withSystem(db, async (tx) => {
      const [d] = await tx
        .insert(devices)
        .values({ tenantId, name: 'Dev', imei: `imei-${stamp}` })
        .returning();
      await tx.insert(dailyRollups).values([
        { tenantId, deviceId: d!.id, day: '2025-02-01', trips: 2, distanceKm: 15, durationS: 3600, maxSpeedKph: 80, speedingSamples: 2, pointCount: 100 },
        { tenantId, deviceId: d!.id, day: '2025-02-02', trips: 1, distanceKm: 20, durationS: 1800, maxSpeedKph: 100, speedingSamples: 0, pointCount: 50 },
      ]);
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const auth = () => ({ headers: { authorization: `Bearer ${token}` } });

  it('summary aggregates the rollup rows over the range', async () => {
    const res = await app.request(`/analytics/summary?from=${from}&to=${to}`, auth());
    expect(res.status).toBe(200);
    const s = (await res.json()) as Record<string, number>;
    expect(s.trips).toBe(3);
    expect(s.distanceKm).toBeCloseTo(35);
    expect(s.maxSpeedKph).toBe(100);
    expect(s.activeDevices).toBe(1);
    expect(s.durationHours).toBeCloseTo(1.5);
  });

  it('distance-by-day returns one entry per rollup day', async () => {
    const res = await app.request(`/analytics/distance-by-day?from=${from}&to=${to}`, auth());
    expect(res.status).toBe(200);
    const { days } = (await res.json()) as { days: Array<{ date: string; distanceKm: number; trips: number }> };
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2025-02-01', distanceKm: 15, trips: 2 });
    expect(days[1]).toMatchObject({ date: '2025-02-02', distanceKm: 20, trips: 1 });
  });
});
