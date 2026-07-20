import { eq, notificationTemplates, tenants, withSystem } from '@trackflow/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from './db.js';
import { getNotificationContent, resolveTemplate } from './template-service.js';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('notification templates (resolve + render)', () => {
  let tenantId: string;

  beforeAll(async () => {
    const [t] = await db
      .insert(tenants)
      .values({ name: 'Tmpl', slug: `tmpl-${Math.random().toString(36).slice(2, 10)}`, locale: 'hi' })
      .returning();
    tenantId = t!.id;
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('falls back to the built-in en default when no tenant template exists', async () => {
    const tmpl = await resolveTemplate(tenantId, 'device.offline', 'en');
    expect(tmpl?.subject).toContain('{{deviceName}}');
    expect(tmpl?.body).toContain('{{lastSeen}}');
  });

  it('honours the requested locale when a built-in exists', async () => {
    const hi = await resolveTemplate(tenantId, 'geofence.enter', 'hi');
    expect(hi?.subject).toContain('प्रवेश'); // Hindi default
  });

  it('returns null for an event the engine does not know', async () => {
    expect(await resolveTemplate(tenantId, 'nonexistent.event')).toBeNull();
  });

  it('uses a tenant override in preference to the built-in default', async () => {
    await withSystem(db, (tx) =>
      tx.insert(notificationTemplates).values({
        tenantId,
        eventType: 'device.offline',
        locale: 'en',
        subject: 'Custom: {{deviceName}} offline',
        body: 'Last seen {{lastSeen}}.',
      }),
    );
    try {
      const tmpl = await resolveTemplate(tenantId, 'device.offline', 'en');
      expect(tmpl?.subject).toBe('Custom: {{deviceName}} offline');
    } finally {
      await withSystem(db, (tx) =>
        tx
          .delete(notificationTemplates)
          .where(eq(notificationTemplates.tenantId, tenantId)),
      );
    }
  });

  it('getNotificationContent uses the tenant locale and renders variables', async () => {
    // Tenant locale is 'hi' (set in beforeAll); built-in hi default for ingest.downtime.
    const rendered = await getNotificationContent(tenantId, 'ingest.downtime', { ageSeconds: 600, activeDevices: 3 });
    expect(rendered?.subject).toContain('इनगेस्ट');
    expect(rendered?.body).toContain('600');
    expect(rendered?.body).toContain('3');
    expect(rendered?.body).not.toContain('{{'); // every placeholder substituted
  });
});
