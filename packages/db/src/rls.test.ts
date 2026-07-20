import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './index.js';
import { devices, tenants } from './schema.js';
import { withSystem, withTenant } from './rls.js';
import { inArray } from 'drizzle-orm';

// Requires a running Postgres with RLS already applied (`pnpm db:rls`) and
// connecting as the NON-superuser app role (superusers bypass RLS). Gated so
// `pnpm test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;
const url =
  process.env.DATABASE_URL ?? 'postgres://trackflow_app:trackflow_app@localhost:5432/trackflow';

function imei(): string {
  return String(Math.floor(Math.random() * 9e14) + 1e14);
}

describe.skipIf(!enabled)('Row-Level Security tenant isolation', () => {
  let db: Database;
  let t1: string;
  let t2: string;
  let d1: string;
  let d2: string;
  const i1 = imei();
  const i2 = imei();

  beforeAll(async () => {
    db = createDb(url);
    const [a] = await db.insert(tenants).values({ name: 'RLS A', slug: `rls-a-${imei()}` }).returning();
    const [b] = await db.insert(tenants).values({ name: 'RLS B', slug: `rls-b-${imei()}` }).returning();
    t1 = a!.id;
    t2 = b!.id;
    d1 = (await withTenant(db, t1, async (tx) =>
      (await tx.insert(devices).values({ tenantId: t1, name: 'A-1', imei: i1 }).returning())[0]!,
    )).id;
    d2 = (await withTenant(db, t2, async (tx) =>
      (await tx.insert(devices).values({ tenantId: t2, name: 'B-1', imei: i2 }).returning())[0]!,
    )).id;
  });

  afterAll(async () => {
    if (db) {
      await withSystem(db, (tx) => tx.delete(devices).where(inArray(devices.id, [d1, d2])));
      await db.delete(tenants).where(inArray(tenants.id, [t1, t2]));
    }
  });

  it('only returns the active tenant’s devices', async () => {
    const a = await withTenant(db, t1, (tx) => tx.select().from(devices));
    expect(a.every((d) => d.tenantId === t1)).toBe(true);
    expect(a.map((d) => d.id)).toContain(d1);
    expect(a.map((d) => d.id)).not.toContain(d2);
  });

  it('isolates the other tenant symmetrically', async () => {
    const b = await withTenant(db, t2, (tx) => tx.select().from(devices));
    expect(b.map((d) => d.id)).toContain(d2);
    expect(b.map((d) => d.id)).not.toContain(d1);
  });

  it('denies reads with no tenant context (FORCE RLS, default-deny)', async () => {
    const rows = await db.select().from(devices).where(inArray(devices.id, [d1, d2]));
    expect(rows).toHaveLength(0);
  });

  it('blocks writing a row for another tenant (WITH CHECK)', async () => {
    await expect(
      withTenant(db, t1, (tx) => tx.insert(devices).values({ tenantId: t2, name: 'evil', imei: imei() })),
    ).rejects.toThrow();
  });
});
