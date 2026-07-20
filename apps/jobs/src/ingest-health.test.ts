import { devices, eq, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from './db.js';
import { checkIngestHealth, runIngestHealthCheck } from './ingest-health.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('ingest health watchdog', () => {
  const staleMs = 5 * 60_000;
  let tenantId: string;
  let deviceId: string;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Ingest', slug: `ingest-${Math.random().toString(36).slice(2, 10)}` })
      .returning();
    tenantId = t!.id;
    await withSystem(db, async (tx) => {
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

  const setDevice = (lastSeen: Date | null, status = 'active') =>
    withSystem(db, (tx) => tx.update(devices).set({ lastSeen, status }).where(eq(devices.id, deviceId)));

  it('is healthy when a device reported recently', async () => {
    await setDevice(new Date());
    const h = await checkIngestHealth({ tenantId, staleMs });
    expect(h.healthy).toBe(true);
    expect(h.activeDevices).toBe(1);
    expect(h.ageSeconds!).toBeLessThan(60);
  });

  it('is unhealthy when the latest write is older than the threshold', async () => {
    await setDevice(new Date(Date.now() - 10 * 60_000));
    const h = await checkIngestHealth({ tenantId, staleMs });
    expect(h.healthy).toBe(false);
    expect(h.ageSeconds!).toBeGreaterThanOrEqual(595);
  });

  it('runIngestHealthCheck returns unhealthy and alerts without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await setDevice(new Date(Date.now() - 10 * 60_000));
    const h = await runIngestHealthCheck({ tenantId, staleMs });
    expect(h.healthy).toBe(false);
    vi.restoreAllMocks();
  });

  it('treats no active devices as healthy (nothing to ingest)', async () => {
    await setDevice(new Date(Date.now() - 10 * 60_000), 'inactive');
    const h = await checkIngestHealth({ tenantId, staleMs });
    expect(h.activeDevices).toBe(0);
    expect(h.healthy).toBe(true);
  });
});
