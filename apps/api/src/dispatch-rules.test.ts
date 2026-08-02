import { eq, tenantNotificationSettings, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemDb as db } from './db.js';
import { type DispatchSettings, getDispatchSettings, inQuietHours, suppressedByQuiet, throttleAllow } from './dispatch-rules.js';
import { MemoryStore } from './middleware/rate-limit-store.js';

const baseSettings: DispatchSettings = {
  quietStart: null,
  quietEnd: null,
  timezone: 'UTC',
  throttlePerHour: 10,
  criticalBypass: true,
};
// Helper to build a specific UTC moment (mins past midnight UTC).
const at = (hh: number, mm = 0) => new Date(Date.UTC(2025, 0, 1, hh, mm));

describe('inQuietHours', () => {
  it('is false when no quiet window is configured', () => {
    expect(inQuietHours(baseSettings, at(23))).toBe(false);
  });

  it('handles a normal (same-day) window', () => {
    const s = { ...baseSettings, quietStart: '09:00', quietEnd: '17:00' };
    expect(inQuietHours(s, at(12))).toBe(true);
    expect(inQuietHours(s, at(8))).toBe(false);
    expect(inQuietHours(s, at(17))).toBe(false); // end is exclusive
  });

  it('handles a midnight-crossing window', () => {
    const s = { ...baseSettings, quietStart: '22:00', quietEnd: '07:00' };
    expect(inQuietHours(s, at(23))).toBe(true);
    expect(inQuietHours(s, at(3))).toBe(true);
    expect(inQuietHours(s, at(12))).toBe(false);
  });

  it('returns false when start equals end (degenerate window)', () => {
    const s = { ...baseSettings, quietStart: '22:00', quietEnd: '22:00' };
    expect(inQuietHours(s, at(22))).toBe(false);
  });
});

describe('suppressedByQuiet', () => {
  const quiet = { ...baseSettings, quietStart: '22:00', quietEnd: '07:00' };

  it('suppresses non-critical alerts inside the window', () => {
    expect(suppressedByQuiet('warning', quiet, at(23))).toBe(true);
    expect(suppressedByQuiet('info', quiet, at(23))).toBe(true);
  });

  it('lets critical alerts through when criticalBypass is on', () => {
    expect(suppressedByQuiet('critical', quiet, at(23))).toBe(false);
  });

  it('suppresses even critical when criticalBypass is off', () => {
    expect(suppressedByQuiet('critical', { ...quiet, criticalBypass: false }, at(23))).toBe(true);
  });

  it('lets everything through outside the window', () => {
    expect(suppressedByQuiet('info', quiet, at(12))).toBe(false);
  });
});

describe('throttleAllow', () => {
  it('allows up to throttlePerHour per (tenant, device, event), then blocks', async () => {
    const store = new MemoryStore();
    const s = { ...baseSettings, throttlePerHour: 3 };
    for (let i = 0; i < 3; i++) {
      expect(await throttleAllow('t1', 'd1', 'geofence.enter', s, store)).toBe(true);
    }
    expect(await throttleAllow('t1', 'd1', 'geofence.enter', s, store)).toBe(false);
  });

  it('keeps distinct devices and events on independent budgets', async () => {
    const store = new MemoryStore();
    const s = { ...baseSettings, throttlePerHour: 1 };
    expect(await throttleAllow('t1', 'd1', 'geofence.enter', s, store)).toBe(true);
    expect(await throttleAllow('t1', 'd2', 'geofence.enter', s, store)).toBe(true); // other device
    expect(await throttleAllow('t1', 'd1', 'geofence.exit', s, store)).toBe(true); // other event
    expect(await throttleAllow('t1', 'd1', 'geofence.enter', s, store)).toBe(false); // now exhausted
  });
});

// Requires a running Postgres. Gated so `pnpm test` stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('getDispatchSettings (DB-backed)', () => {
  let tenantId: string;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Rules', slug: `rules-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
  });
  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('returns sensible defaults when the tenant has no settings row', async () => {
    const s = await getDispatchSettings(tenantId);
    expect(s).toMatchObject({ quietStart: null, quietEnd: null, timezone: 'UTC', throttlePerHour: 10, criticalBypass: true });
  });

  it('reads a persisted settings row', async () => {
    await withSystem(db, 'test-fixture', (tx) =>
      tx.insert(tenantNotificationSettings).values({
        tenantId,
        quietStart: '22:00',
        quietEnd: '07:00',
        timezone: 'Asia/Kolkata',
        throttlePerHour: 5,
        criticalBypass: false,
      }),
    );
    const s = await getDispatchSettings(tenantId);
    expect(s).toMatchObject({ quietStart: '22:00', quietEnd: '07:00', timezone: 'Asia/Kolkata', throttlePerHour: 5, criticalBypass: false });
  });
});
