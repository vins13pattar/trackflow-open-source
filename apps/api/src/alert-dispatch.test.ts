import { alertDeliveries, alerts, devices, eq, notificationRoutes, notificationTemplates, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dispatchAlerts } from './alert-dispatch.js';
import { systemDb as db } from './db.js';
import type { FiredAlert } from './geofence-service.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('dispatchAlerts: template rendering + per-event routing', () => {
  let tenantId: string;
  let deviceId: string;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Disp', slug: `disp-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
    await withSystem(db, 'test-fixture', async (tx) => {
      const [d] = await tx
        .insert(devices)
        .values({ tenantId, name: 'Bus-Disp', imei: `imei-${Math.random().toString(36).slice(2, 12)}` })
        .returning();
      deviceId = d!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  async function makeAlert(overrides: Partial<FiredAlert> = {}): Promise<FiredAlert> {
    const [a] = await withSystem(db, 'test-fixture', (tx) =>
      tx
        .insert(alerts)
        .values({
          tenantId,
          deviceId,
          geofenceId: null,
          type: overrides.type ?? 'device.offline',
          severity: overrides.severity ?? 'warning',
          title: overrides.title ?? 'Original title',
          message: overrides.message ?? 'Original message',
          lat: null,
          lon: null,
        })
        .returning(),
    );
    return {
      id: a!.id,
      deviceId,
      geofenceId: null,
      type: a!.type,
      severity: a!.severity,
      title: a!.title,
      message: a!.message,
      lat: null,
      lon: null,
      createdAt: a!.createdAt.toISOString(),
      channels: overrides.channels ?? ['console'],
      recipients: overrides.recipients ?? {},
    };
  }

  it('renders the tenant template (overriding the pre-rendered alert text)', async () => {
    // Tenant override for 'device.offline' that substitutes the device name.
    await withSystem(db, 'test-fixture', (tx) =>
      tx.insert(notificationTemplates).values({
        tenantId,
        eventType: 'device.offline',
        locale: 'en',
        subject: 'Custom: {{deviceName}} dropped',
        body: 'Body for {{deviceName}}',
      }),
    );

    const a = await makeAlert({ type: 'device.offline', channels: ['console'] });
    await dispatchAlerts(tenantId, [a]);

    const log = await withSystem(db, 'test-fixture', (tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.alertId, a.id)),
    );
    // The delivery row records the rendered subject/body (what we tried to send).
    expect(log.some((r) => r.subject.includes('Bus-Disp dropped'))).toBe(true);
    expect(log.some((r) => r.body.includes('Body for Bus-Disp'))).toBe(true);
  });

  it('per-event route overrides the alert\'s channels', async () => {
    // Route geofence.enter via only the 'console' channel even though the alert
    // is configured with [sms].
    await withSystem(db, 'test-fixture', (tx) =>
      tx.insert(notificationRoutes).values({ tenantId, eventType: 'geofence.enter', channels: ['console'] }),
    );

    const a = await makeAlert({ type: 'geofence.enter', channels: ['sms'] });
    await dispatchAlerts(tenantId, [a]);

    const log = await withSystem(db, 'test-fixture', (tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.alertId, a.id)),
    );
    expect(log.map((r) => r.channel)).toContain('console'); // routed channel was tried
    expect(log.map((r) => r.channel)).not.toContain('sms'); // original channel was overridden
  });
});
