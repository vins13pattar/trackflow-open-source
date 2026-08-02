import { devices, eq, positions, sql, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb as db } from './db.js';
import { recordPosition } from './positions-service.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('ingest idempotency', () => {
  let tenantId: string;
  let deviceId: string;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Ingest', slug: `pos-${Math.random().toString(36).slice(2, 10)}` })
      .returning();
    tenantId = t!.id;
    await withSystem(db, 'test-fixture', async (tx) => {
      const [d] = await tx
        .insert(devices)
        .values({ tenantId, name: 'Dev', imei: `imei-${Math.random().toString(36).slice(2, 12)}` })
        .returning();
      deviceId = d!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const input = (fixTime: Date) => ({
    deviceId,
    tenantId,
    imei: 'x',
    latitude: 12.97,
    longitude: 77.59,
    speedKph: 10,
    course: 90,
    gpsValid: true,
    fixTime,
    kind: 'location',
  });
  const record = (fixTime: Date) => withSystem(db, 'test-fixture', (tx) => recordPosition(tx, input(fixTime)));
  const count = async () => {
    const rows = await withSystem(db, 'test-fixture', (tx) =>
      tx.select({ n: sql<string>`count(*)` }).from(positions).where(eq(positions.deviceId, deviceId)),
    );
    return Number(rows[0]!.n);
  };

  it('drops a retransmitted fix (same device + fix_time) but keeps distinct fixes', async () => {
    const t = new Date('2025-03-01T10:00:00.000Z');
    await record(t);
    await record(t); // retransmission
    expect(await count()).toBe(1);

    await record(new Date('2025-03-01T10:00:05.000Z')); // a genuinely new fix
    expect(await count()).toBe(2);
  });
});
