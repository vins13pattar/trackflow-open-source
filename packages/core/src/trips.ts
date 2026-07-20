/**
 * Trip detection: segments a device's position stream into trips using simple
 * stop/gap heuristics. Pure and unit-testable; the rollup job feeds it positions
 * and persists the results.
 */
import { haversineMeters } from './geofence.js';

export interface TripPoint {
  lat: number;
  lng: number;
  speedKph: number;
  /** epoch ms */
  t: number;
}

export interface Trip {
  startedAt: number;
  endedAt: number;
  durationS: number;
  distanceKm: number;
  avgSpeedKph: number;
  maxSpeedKph: number;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  pointCount: number;
  speedingSamples: number;
}

export interface TripConfig {
  /** At or below this speed the device is considered stopped. */
  stopSpeedKph: number;
  /** A stop this long ends the current trip. */
  stopMinDurationS: number;
  /** A time gap larger than this splits the trip (lost signal / powered off). */
  maxGapS: number;
  minTripDistanceKm: number;
  minTripDurationS: number;
  /** Samples above this count toward driver-behavior scoring. */
  speedLimitKph: number;
}

export const DEFAULT_TRIP_CONFIG: TripConfig = {
  stopSpeedKph: 3,
  stopMinDurationS: 180,
  maxGapS: 600,
  minTripDistanceKm: 0.2,
  minTripDurationS: 60,
  speedLimitKph: 80,
};

function buildTrip(points: TripPoint[], cfg: TripConfig): Trip | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let distanceM = 0;
  let maxSpeedKph = 0;
  let speedingSamples = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineMeters(points[i - 1]!, points[i]!);
  }
  for (const p of points) {
    if (p.speedKph > maxSpeedKph) maxSpeedKph = p.speedKph;
    if (p.speedKph > cfg.speedLimitKph) speedingSamples += 1;
  }
  const durationS = Math.round((last.t - first.t) / 1000);
  const distanceKm = distanceM / 1000;
  const avgSpeedKph = durationS > 0 ? distanceKm / (durationS / 3600) : 0;
  return {
    startedAt: first.t,
    endedAt: last.t,
    durationS,
    distanceKm,
    avgSpeedKph,
    maxSpeedKph,
    start: { lat: first.lat, lng: first.lng },
    end: { lat: last.lat, lng: last.lng },
    pointCount: points.length,
    speedingSamples,
  };
}

export function detectTrips(points: TripPoint[], config: Partial<TripConfig> = {}): Trip[] {
  const cfg = { ...DEFAULT_TRIP_CONFIG, ...config };
  const trips: Trip[] = [];
  if (points.length < 2) return trips;

  let current: TripPoint[] = [];
  let stopStart: { t: number; idx: number } | null = null;

  const finalize = (pts: TripPoint[]) => {
    const trip = buildTrip(pts, cfg);
    if (trip && trip.distanceKm >= cfg.minTripDistanceKm && trip.durationS >= cfg.minTripDurationS) {
      trips.push(trip);
    }
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = i > 0 ? points[i - 1]! : null;

    if (prev && p.t - prev.t > cfg.maxGapS * 1000) {
      finalize(current);
      current = [];
      stopStart = null;
    }

    current.push(p);
    const idxInCurrent = current.length - 1;

    if (p.speedKph <= cfg.stopSpeedKph) {
      if (!stopStart) {
        stopStart = { t: p.t, idx: idxInCurrent };
      } else if (p.t - stopStart.t >= cfg.stopMinDurationS * 1000) {
        finalize(current.slice(0, stopStart.idx + 1));
        current = [];
        stopStart = null;
      }
    } else {
      stopStart = null;
    }
  }

  finalize(current);
  return trips;
}
