/**
 * Geofence geometry and the entry/exit/dwell transition engine.
 *
 * Pure functions only — the API loads/persists state and the decoder feeds in
 * positions, but the decision logic lives here so it is unit-testable and runs
 * identically wherever it's hosted (Node ingest path today, a Durable Object
 * later).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type GeofenceShape =
  | { type: 'circle'; center: LatLng; radiusM: number }
  | { type: 'polygon'; points: LatLng[] };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointInCircle(p: LatLng, center: LatLng, radiusM: number): boolean {
  return haversineMeters(p, center) <= radiusM;
}

/** Ray-casting point-in-polygon (treats lng as x, lat as y). */
export function pointInPolygon(p: LatLng, polygon: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.lat > p.lat !== b.lat > p.lat &&
      p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isInside(p: LatLng, shape: GeofenceShape): boolean {
  return shape.type === 'circle'
    ? pointInCircle(p, shape.center, shape.radiusM)
    : pointInPolygon(p, shape.points);
}

export type TransitionType = 'entry' | 'exit' | 'dwell';

export interface GeofenceRule {
  id: string;
  shape: GeofenceShape;
  onEntry: boolean;
  onExit: boolean;
  onDwell: boolean;
  dwellSeconds: number;
  throttleSeconds: number;
}

export interface GeofenceState {
  inside: boolean;
  enteredAt: number | null;
  dwelled: boolean;
  lastEventAt: number | null;
}

export interface TransitionResult {
  geofenceId: string;
  /** The fired event, or null if this position produced none. */
  type: TransitionType | null;
  /** The state to persist for the next evaluation. */
  state: GeofenceState;
}

const EMPTY_STATE: GeofenceState = { inside: false, enteredAt: null, dwelled: false, lastEventAt: null };

/**
 * Evaluates one geofence against a new position given the previous state.
 * Detects entry (outside→inside), exit (inside→outside), and a one-shot dwell
 * after `dwellSeconds` of continuous presence. Honors per-geofence throttling.
 */
export function evaluateTransition(
  rule: GeofenceRule,
  prev: GeofenceState | null,
  point: LatLng,
  nowMs: number,
): TransitionResult {
  const previous = prev ?? EMPTY_STATE;
  const inside = isInside(point, rule.shape);
  let { enteredAt, dwelled, lastEventAt } = previous;
  let type: TransitionType | null = null;

  if (inside && !previous.inside) {
    enteredAt = nowMs;
    dwelled = false;
    if (rule.onEntry) type = 'entry';
  } else if (!inside && previous.inside) {
    enteredAt = null;
    dwelled = false;
    if (rule.onExit) type = 'exit';
  } else if (inside && previous.inside) {
    if (rule.onDwell && !dwelled && enteredAt != null && nowMs - enteredAt >= rule.dwellSeconds * 1000) {
      type = 'dwell';
      dwelled = true;
    }
  }

  // Suppress events that arrive within the throttle window.
  if (type && lastEventAt != null && rule.throttleSeconds > 0 && nowMs - lastEventAt < rule.throttleSeconds * 1000) {
    type = null;
  }
  if (type) lastEventAt = nowMs;

  return { geofenceId: rule.id, type, state: { inside, enteredAt, dwelled, lastEventAt } };
}
