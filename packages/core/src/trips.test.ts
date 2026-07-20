import { describe, expect, it } from 'vitest';
import { type TripPoint, detectTrips } from './trips.js';

const LAT = 12.97;
const COS = Math.cos((LAT * Math.PI) / 180);

/** Generates `n` points moving east at `speedKph`, `stepS` apart, from `startLng`. */
function moving(fromMs: number, n: number, startLng: number, speedKph = 40, stepS = 10): TripPoint[] {
  const stepLng = ((speedKph / 3.6) * stepS) / (111_320 * COS);
  const pts: TripPoint[] = [];
  let lng = startLng;
  for (let i = 0; i < n; i++) {
    pts.push({ lat: LAT, lng, speedKph, t: fromMs + i * stepS * 1000 });
    lng += stepLng;
  }
  return pts;
}

function stopped(fromMs: number, n: number, lng: number, stepS = 10): TripPoint[] {
  return Array.from({ length: n }, (_, i) => ({ lat: LAT, lng, speedKph: 0, t: fromMs + i * stepS * 1000 }));
}

describe('detectTrips', () => {
  it('detects a single continuous drive', () => {
    const trips = detectTrips(moving(0, 30, 77.5));
    expect(trips).toHaveLength(1);
    expect(trips[0]!.distanceKm).toBeGreaterThan(1);
    expect(trips[0]!.avgSpeedKph).toBeGreaterThan(20);
    expect(trips[0]!.maxSpeedKph).toBe(40);
  });

  it('splits two drives separated by a long stop', () => {
    const leg1 = moving(0, 30, 77.5);
    const stopLng = leg1[leg1.length - 1]!.lng;
    const stop = stopped(300_000, 20, stopLng); // 190s stop > threshold
    const leg2 = moving(560_000, 30, stopLng);
    const trips = detectTrips([...leg1, ...stop, ...leg2]);
    expect(trips).toHaveLength(2);
    expect(trips[0]!.distanceKm).toBeGreaterThan(1);
    expect(trips[1]!.distanceKm).toBeGreaterThan(1);
  });

  it('splits on a long signal gap', () => {
    const leg1 = moving(0, 15, 77.5);
    const leg2 = moving(2_000_000, 15, 77.6); // >600s gap
    const trips = detectTrips([...leg1, ...leg2]);
    expect(trips).toHaveLength(2);
  });

  it('ignores negligible movement (below min distance)', () => {
    const jitter: TripPoint[] = [
      { lat: LAT, lng: 77.5, speedKph: 1, t: 0 },
      { lat: LAT, lng: 77.50001, speedKph: 1, t: 20_000 },
      { lat: LAT, lng: 77.50002, speedKph: 1, t: 40_000 },
    ];
    expect(detectTrips(jitter)).toHaveLength(0);
  });

  it('counts speeding samples for driver behavior', () => {
    const trips = detectTrips(moving(0, 30, 77.5, 100)); // 100 kph > 80 limit
    expect(trips[0]!.speedingSamples).toBe(30);
  });
});
