import { type Tx, alerts, and, deviceGroupMembers, eq, geofenceStates, geofences, inArray } from '@trackflow/db';
import type { Geofence, GeofenceRecipients } from '@trackflow/db';
import {
  type GeofenceRule,
  type GeofenceState,
  type TransitionType,
  evaluateTransition,
} from '@trackflow/core';
import type { AlertEvent } from './bus.js';

export interface GeofenceEvalContext {
  tenantId: string;
  deviceId: string;
  lat: number;
  lon: number;
  fixTime: Date;
}

/** An alert plus the dispatch config from its geofence. */
export interface FiredAlert extends AlertEvent {
  channels: string[];
  recipients: GeofenceRecipients;
}

const SEVERITY: Record<TransitionType, string> = { entry: 'medium', exit: 'medium', dwell: 'low' };
const VERB: Record<TransitionType, string> = { entry: 'entered', exit: 'exited', dwell: 'is dwelling in' };

function ruleFor(g: Geofence): GeofenceRule | null {
  const shape =
    g.type === 'circle'
      ? g.centerLat != null && g.centerLon != null && g.radiusM != null
        ? ({ type: 'circle', center: { lat: g.centerLat, lng: g.centerLon }, radiusM: g.radiusM } as const)
        : null
      : g.points && g.points.length >= 3
        ? ({ type: 'polygon', points: g.points } as const)
        : null;
  if (!shape) return null;
  return {
    id: g.id,
    shape,
    onEntry: g.onEntry,
    onExit: g.onExit,
    onDwell: g.onDwell,
    dwellSeconds: g.dwellSeconds,
    throttleSeconds: g.throttleSeconds,
  };
}

/**
 * Evaluates the device's applicable geofences against a new position, persists
 * transition state, writes alert rows, and returns the alerts to dispatch.
 * Runs on the caller's transaction. Always filters by tenantId explicitly so it
 * is correct on both the tenant-scoped and system (RLS-bypass) paths.
 */
export async function evaluateGeofences(tx: Tx, ctx: GeofenceEvalContext): Promise<FiredAlert[]> {
  const active = await tx
    .select()
    .from(geofences)
    .where(and(eq(geofences.tenantId, ctx.tenantId), eq(geofences.status, 'active')));

  // Resolve which groups this device belongs to once, then match any of the
  // three targeting modes (allDevices / explicit deviceIds / any group).
  const memberRows = await tx
    .select({ groupId: deviceGroupMembers.groupId })
    .from(deviceGroupMembers)
    .where(eq(deviceGroupMembers.deviceId, ctx.deviceId));
  const deviceGroupSet = new Set(memberRows.map((r) => r.groupId));
  const applicable = active.filter(
    (g) => g.allDevices || g.deviceIds.includes(ctx.deviceId) || g.groupIds.some((id) => deviceGroupSet.has(id)),
  );
  if (applicable.length === 0) return [];

  const ids = applicable.map((g) => g.id);
  const states = await tx
    .select()
    .from(geofenceStates)
    .where(and(eq(geofenceStates.deviceId, ctx.deviceId), inArray(geofenceStates.geofenceId, ids)));
  const stateByGeofence = new Map(states.map((s) => [s.geofenceId, s]));

  const nowMs = ctx.fixTime.getTime();
  const point = { lat: ctx.lat, lng: ctx.lon };
  const fired: FiredAlert[] = [];

  for (const g of applicable) {
    const rule = ruleFor(g);
    if (!rule) continue;
    const prevRow = stateByGeofence.get(g.id);
    const prev: GeofenceState | null = prevRow
      ? { inside: prevRow.inside, enteredAt: prevRow.enteredAt, dwelled: prevRow.dwelled, lastEventAt: prevRow.lastEventAt }
      : null;

    const result = evaluateTransition(rule, prev, point, nowMs);

    await tx
      .insert(geofenceStates)
      .values({
        tenantId: ctx.tenantId,
        deviceId: ctx.deviceId,
        geofenceId: g.id,
        inside: result.state.inside,
        enteredAt: result.state.enteredAt,
        dwelled: result.state.dwelled,
        lastEventAt: result.state.lastEventAt,
      })
      .onConflictDoUpdate({
        target: [geofenceStates.deviceId, geofenceStates.geofenceId],
        set: {
          inside: result.state.inside,
          enteredAt: result.state.enteredAt,
          dwelled: result.state.dwelled,
          lastEventAt: result.state.lastEventAt,
        },
      });

    if (!result.type) continue;

    const title = `Geofence ${result.type}`;
    const message = `Device ${VERB[result.type]} "${g.name}"`;
    const [row] = await tx
      .insert(alerts)
      .values({
        tenantId: ctx.tenantId,
        deviceId: ctx.deviceId,
        geofenceId: g.id,
        type: `geofence_${result.type}`,
        severity: SEVERITY[result.type],
        title,
        message,
        lat: ctx.lat,
        lon: ctx.lon,
      })
      .returning({ id: alerts.id, createdAt: alerts.createdAt });

    fired.push({
      id: row!.id,
      deviceId: ctx.deviceId,
      geofenceId: g.id,
      type: `geofence_${result.type}`,
      severity: SEVERITY[result.type],
      title,
      message,
      lat: ctx.lat,
      lon: ctx.lon,
      createdAt: row!.createdAt.toISOString(),
      channels: g.channels,
      recipients: g.recipients,
    });
  }

  return fired;
}
