/** Meitrack frame encoders for the simulator and round-trip tests. */
import { xorChecksum } from './index.js';

function stamp(t: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    pad(t.getUTCFullYear() % 100) +
    pad(t.getUTCMonth() + 1) +
    pad(t.getUTCDate()) +
    pad(t.getUTCHours()) +
    pad(t.getUTCMinutes()) +
    pad(t.getUTCSeconds())
  );
}

export interface MeitrackLocationInput {
  imei: string;
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  /** Default 35 = track-by-time (periodic). */
  eventCode?: number;
  gpsValid?: boolean;
  satellites?: number;
  gsmSignal?: number;
  hdop?: number;
  altitude?: number;
  /** km (we encode as metres on the wire). */
  odometerKm?: number;
  runtimeSec?: number;
  ioStateHex?: string; // 4 chars
  batteryVoltage?: number; // volts (analog 4)
  externalVoltage?: number; // volts (analog 5)
  time?: Date;
  /** Frame flag: A=normal, D=track-on-demand, E=event. */
  flag?: 'A' | 'D' | 'E';
}

export function encodeMeitrackLocation(input: MeitrackLocationInput): Buffer {
  const t = input.time ?? new Date();
  const flag = input.flag ?? (input.eventCode && input.eventCode !== 35 ? 'E' : 'A');
  const valid = (input.gpsValid ?? true) ? 'A' : 'V';
  const mileageM = Math.round((input.odometerKm ?? 0) * 1000);
  // Analog field: AD1|AD2|AD3|battery|external as millivolts.
  const ad = [
    '',
    '',
    '',
    input.batteryVoltage !== undefined ? String(Math.round(input.batteryVoltage * 1000)) : '',
    input.externalVoltage !== undefined ? String(Math.round(input.externalVoltage * 1000)) : '',
  ].join('|');
  const cells = '460|0|2812|73B7';
  const dataParts = [
    String(input.eventCode ?? 35),
    input.latitude.toFixed(6),
    input.longitude.toFixed(6),
    stamp(t),
    valid,
    String(input.satellites ?? 8),
    String(input.gsmSignal ?? 22),
    String(input.speedKph ?? 0),
    String(input.course ?? 0),
    String(input.hdop ?? 1),
    String(input.altitude ?? 0),
    String(mileageM),
    String(input.runtimeSec ?? 0),
    cells,
    input.ioStateHex ?? '0000',
    ad,
  ];

  // Build twice: first to learn the length so the in-frame <length> is correct.
  const partial = `,${input.imei},AAA,${dataParts.join(',')},`;
  // Length spans `$$<flag><length>` through `*XX\r\n` inclusive.
  // Try lengths until the printed value equals the actual length (numeric stability).
  let lenStr = '';
  for (let guess = 50; guess < 4000; guess++) {
    const candidate = String(guess);
    const bodyLen = 2 + 1 + candidate.length + partial.length + 3 + 2; // "$$" + flag + len + body + "*XX" + CRLF
    if (bodyLen === guess) {
      lenStr = candidate;
      break;
    }
  }
  if (!lenStr) throw new Error('Could not converge on Meitrack frame length');

  const prefixBody = `$$${flag}${lenStr}${partial}`;
  const body = Buffer.from(prefixBody, 'ascii');
  const sum = xorChecksum(body);
  return Buffer.concat([body, Buffer.from(`*${sum}\r\n`, 'ascii')]);
}
