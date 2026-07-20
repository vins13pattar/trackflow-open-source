import { deviceGroupMembers, deviceGroups, eq, geofenceStates, geofences, tenants, withSystem } from '@trackflow/db';
import { issueTokens } from '@trackflow/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './env.js';
import { evaluateGeofences } from './geofence-service.js';
import { devices } from '@trackflow/db';

// Requires a running Postgres with the schema applied. Gated so `pnpm test`
// stays green without a DB.
const enabled = !!process.env.TF_DB_TESTS;

describe.skipIf(!enabled)('device groups: CRUD + group-targeted geofence dispatch', () => {
  const app = createApp();
  let tenantId: string;
  let token: string;
  let deviceA: string;
  let deviceB: string;

  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: 'Groups', slug: `gr-${Math.random().toString(36).slice(2, 10)}` }).returning();
    tenantId = t!.id;
    token = (await issueTokens({ sub: 'u', tid: tenantId, role: 'owner' }, env.jwt)).accessToken;
    await withSystem(db, async (tx) => {
      const [a] = await tx.insert(devices).values({ tenantId, name: 'Bus-1', imei: `imei-${Math.random().toString(36).slice(2, 12)}` }).returning();
      const [b] = await tx.insert(devices).values({ tenantId, name: 'Bus-2', imei: `imei-${Math.random().toString(36).slice(2, 12)}` }).returning();
      deviceA = a!.id;
      deviceB = b!.id;
    });
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

  it('creates, lists, edits, and deletes a group; replaces membership', async () => {
    const create = await app.request('/device-groups', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'Mumbai Fleet', color: '#00aa55', deviceIds: [deviceA] }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; deviceIds: string[] };
    expect(created.deviceIds).toEqual([deviceA]);

    const list = await (await app.request('/device-groups', { headers: headers() })).json() as { groups: Array<{ id: string }> };
    expect(list.groups.some((g) => g.id === created.id)).toBe(true);

    const patched = await (await app.request(`/device-groups/${created.id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify({ name: 'Renamed' }),
    })).json() as { name: string };
    expect(patched.name).toBe('Renamed');

    // Replace membership to {deviceA, deviceB}.
    const setMembers = await app.request(`/device-groups/${created.id}/devices`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ deviceIds: [deviceA, deviceB] }),
    });
    expect(setMembers.status).toBe(200);
    const setResult = (await setMembers.json()) as { deviceIds: string[] };
    expect(new Set(setResult.deviceIds)).toEqual(new Set([deviceA, deviceB]));

    const del = await app.request(`/device-groups/${created.id}`, { method: 'DELETE', headers: headers() });
    expect(del.status).toBe(204);
  });

  it('a geofence targeting a group dispatches to that group\'s members', async () => {
    // Group containing only deviceA.
    const [g] = await withSystem(db, (tx) => tx.insert(deviceGroups).values({ tenantId, name: 'East', color: '#abcdef' }).returning());
    await withSystem(db, (tx) => tx.insert(deviceGroupMembers).values({ tenantId, groupId: g!.id, deviceId: deviceA }));
    // Geofence targeting only that group (allDevices=false, no explicit deviceIds).
    const [zone] = await withSystem(db, (tx) => tx.insert(geofences).values({
      tenantId, name: 'Zone', type: 'circle', centerLat: 12.97, centerLon: 77.59, radiusM: 200,
      onEntry: true, onExit: true, allDevices: false, deviceIds: [], groupIds: [g!.id],
    }).returning());

    try {
      // deviceA is in the group -> entering the zone should fire one alert.
      const firedA = await withSystem(db, (tx) => evaluateGeofences(tx, {
        tenantId, deviceId: deviceA, lat: 12.97, lon: 77.59, fixTime: new Date(),
      }));
      expect(firedA).toHaveLength(1);
      expect(firedA[0]?.geofenceId).toBe(zone!.id);

      // deviceB is NOT in the group -> no alert.
      const firedB = await withSystem(db, (tx) => evaluateGeofences(tx, {
        tenantId, deviceId: deviceB, lat: 12.97, lon: 77.59, fixTime: new Date(),
      }));
      expect(firedB).toHaveLength(0);
    } finally {
      await withSystem(db, (tx) => tx.delete(geofenceStates).where(eq(geofenceStates.geofenceId, zone!.id)));
      await withSystem(db, (tx) => tx.delete(geofences).where(eq(geofences.id, zone!.id)));
      await withSystem(db, (tx) => tx.delete(deviceGroups).where(eq(deviceGroups.id, g!.id)));
    }
  });
});
