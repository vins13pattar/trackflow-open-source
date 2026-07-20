import { describe, expect, it } from 'vitest';
import {
  type GeofenceRule,
  type GeofenceState,
  evaluateTransition,
  haversineMeters,
  pointInCircle,
  pointInPolygon,
} from './geofence.js';

describe('geofence geometry', () => {
  it('measures distance (1° latitude ≈ 111 km)', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });

  it('detects points inside/outside a circle', () => {
    const center = { lat: 12.9716, lng: 77.5946 };
    expect(pointInCircle({ lat: 12.9718, lng: 77.5948 }, center, 200)).toBe(true);
    expect(pointInCircle({ lat: 13.05, lng: 77.7 }, center, 200)).toBe(false);
  });

  it('detects points inside/outside a polygon', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 2, lng: 2 },
      { lat: 2, lng: 0 },
    ];
    expect(pointInPolygon({ lat: 1, lng: 1 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 3, lng: 1 }, square)).toBe(false);
  });
});

describe('geofence transition engine', () => {
  const center = { lat: 12.9716, lng: 77.5946 };
  const rule: GeofenceRule = {
    id: 'g1',
    shape: { type: 'circle', center, radiusM: 150 },
    onEntry: true,
    onExit: true,
    onDwell: true,
    dwellSeconds: 60,
    throttleSeconds: 0,
  };
  const inside = { lat: 12.9716, lng: 77.5946 };
  const outside = { lat: 13.05, lng: 77.7 };

  it('fires entry when crossing in', () => {
    const r = evaluateTransition(rule, null, inside, 1000);
    expect(r.type).toBe('entry');
    expect(r.state.inside).toBe(true);
    expect(r.state.enteredAt).toBe(1000);
  });

  it('fires nothing while staying inside (before dwell)', () => {
    const prev: GeofenceState = { inside: true, enteredAt: 1000, dwelled: false, lastEventAt: 1000 };
    expect(evaluateTransition(rule, prev, inside, 30_000).type).toBeNull();
  });

  it('fires dwell once after the threshold, then not again', () => {
    const prev: GeofenceState = { inside: true, enteredAt: 1000, dwelled: false, lastEventAt: 1000 };
    const dwell = evaluateTransition(rule, prev, inside, 1000 + 60_000);
    expect(dwell.type).toBe('dwell');
    expect(dwell.state.dwelled).toBe(true);
    const again = evaluateTransition(rule, dwell.state, inside, 1000 + 120_000);
    expect(again.type).toBeNull();
  });

  it('fires exit when crossing out', () => {
    const prev: GeofenceState = { inside: true, enteredAt: 1000, dwelled: true, lastEventAt: 1000 };
    const r = evaluateTransition(rule, prev, outside, 200_000);
    expect(r.type).toBe('exit');
    expect(r.state.inside).toBe(false);
  });

  it('suppresses events inside the throttle window', () => {
    const throttled: GeofenceRule = { ...rule, throttleSeconds: 300 };
    const prev: GeofenceState = { inside: false, enteredAt: null, dwelled: false, lastEventAt: 1000 };
    expect(evaluateTransition(throttled, prev, inside, 1000 + 10_000).type).toBeNull();
  });
});
