import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DeviceStatus } from './types';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

/** A device is "online" if it reported within the freshness window. */
export function isOnline(lastSeen: string | null): boolean {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS;
}

/**
 * The status to display: admin state (inactive/maintenance) takes precedence;
 * otherwise connectivity is derived from data freshness (active=live vs offline).
 */
export function deviceConnectivity(d: { status: string; lastSeen: string | null }): DeviceStatus {
  if (d.status === 'inactive') return 'inactive';
  if (d.status === 'maintenance') return 'maintenance';
  return isOnline(d.lastSeen) ? 'active' : 'offline';
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatSpeed(kph: number): string {
  return `${Math.round(kph)} km/h`;
}

/** Converts a #rrggbb hex color to a Tailwind HSL component string ("H S% L%"). */
export function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = Number.parseInt(m[1]!, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Approximates a geographic circle as a GeoJSON polygon ring ([lng,lat][]). */
export function circleToPolygon(
  center: { lat: number; lng: number },
  radiusM: number,
  steps = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  const latR = radiusM / 111_320;
  const lngR = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + lngR * Math.cos(theta), center.lat + latR * Math.sin(theta)]);
  }
  return ring;
}
