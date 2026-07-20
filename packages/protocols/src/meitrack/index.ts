/**
 * Meitrack MT/T1/MVT/T366 decoder — ASCII protocol with XOR checksum.
 *
 * Frame:  $$<flag><length>,<imei>,<cmd>,<data>,*<XX>\r\n
 *   <flag>   one byte: A (normal), D (track-on-demand), E (event)
 *   <length> ASCII decimal byte count from `$$` through `\r\n` (inclusive)
 *   <cmd>    AAA = location, AAB/AAC = event variants, BBB/CCC = config replies
 *   <XX>     two ASCII hex digits = XOR of all bytes from `$$` to the `*`
 *            (exclusive). \r\n terminates the frame.
 *
 * Standard AAA payload positions (Meitrack protocol manual, "Tracker Communication
 * Protocol", section 5.1):
 *   data[0] = event code
 *   data[1] = latitude (decimal degrees)
 *   data[2] = longitude (decimal degrees)
 *   data[3] = date YYMMDDhhmmss (UTC)
 *   data[4] = position valid (A/V)
 *   data[5] = satellites
 *   data[6] = gsm signal
 *   data[7] = speed km/h
 *   data[8] = course
 *   data[9] = HDOP
 *   data[10] = altitude m
 *   data[11] = mileage (m)
 *   data[12] = runtime (s)
 *   data[13] = base-station info MCC|MNC|LAC|CID
 *   data[14] = digital I/O hex (4 chars)
 *   data[15] = analog inputs AD1|AD2|... (millivolts)
 */
import type {
  Attributes,
  DecodeContext,
  DecodeResult,
  DecodedMessage,
  Decoder,
  Position,
} from '../base/types.js';

const FRAME_START_0 = 0x24; // '$'
const FRAME_TERM = '\r\n';

/** XOR of `[from, end)` formatted as two upper-case ASCII hex digits. */
export function xorChecksum(buf: Buffer, from = 0, end = buf.length): string {
  let x = 0;
  for (let i = from; i < end; i++) x ^= buf[i]!;
  return x.toString(16).toUpperCase().padStart(2, '0');
}

function parseDate(yymmddhhmmss: string): Date | null {
  if (yymmddhhmmss.length < 12) return null;
  const yy = Number(yymmddhhmmss.slice(0, 2));
  const mm = Number(yymmddhhmmss.slice(2, 4));
  const dd = Number(yymmddhhmmss.slice(4, 6));
  const hh = Number(yymmddhhmmss.slice(6, 8));
  const mi = Number(yymmddhhmmss.slice(8, 10));
  const ss = Number(yymmddhhmmss.slice(10, 12));
  if (![yy, mm, dd, hh, mi, ss].every(Number.isFinite)) return null;
  return new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Meitrack event code → normalised alarm label. */
export const EVENT_CODES: Record<number, string> = {
  1: 'sos',
  2: 'input2_active',
  3: 'input3_active',
  9: 'low_battery_warning',
  17: 'low_battery',
  18: 'low_external_power',
  19: 'overspeed',
  20: 'enter_geofence',
  21: 'exit_geofence',
  22: 'external_power_off',
  23: 'external_power_on',
  24: 'gps_signal_lost',
  25: 'gps_signal_recovered',
  26: 'enter_sleep',
  27: 'exit_sleep',
  28: 'gps_antenna_cut',
  29: 'device_reboot',
  31: 'heartbeat',
  32: 'tow',
  33: 'stop_moving',
  34: 'start_moving',
  35: 'track_by_time', // periodic
  36: 'track_by_distance',
  37: 'rfid',
  39: 'harsh_acceleration',
  40: 'harsh_braking',
  41: 'harsh_cornering',
};

function parsePosition(parts: string[]): Position | null {
  const latitude = num(parts[1]);
  const longitude = num(parts[2]);
  const fixTime = parseDate(parts[3] ?? '');
  if (latitude === undefined || longitude === undefined || !fixTime) return null;
  return {
    latitude,
    longitude,
    speedKph: num(parts[7]) ?? 0,
    course: num(parts[8]) ?? 0,
    gpsValid: parts[4] === 'A',
    fixTime,
    satellites: num(parts[5]),
  };
}

function parseAttributes(parts: string[]): Attributes {
  const attrs: Attributes = {};
  const gsm = num(parts[6]);
  if (gsm !== undefined) attrs.gsmSignal = gsm;
  const hdop = num(parts[9]);
  if (hdop !== undefined) attrs.hdop = hdop;
  const altitude = num(parts[10]);
  if (altitude !== undefined) attrs.altitude = altitude;
  const mileage = num(parts[11]);
  if (mileage !== undefined) attrs.odometer = Math.round(mileage / 1000); // m → km
  const runtime = num(parts[12]);
  if (runtime !== undefined) attrs.runtimeSec = runtime;
  const ioHex = parts[14];
  if (ioHex && /^[0-9a-fA-F]+$/.test(ioHex)) attrs.ioState = ioHex.toUpperCase();
  // Analog inputs: AD1|AD2|AD3|battery|externalPower (millivolts).
  const ad = parts[15];
  if (ad) {
    const ads = ad.split('|').map(num);
    if (ads[3] !== undefined) attrs.batteryVoltage = ads[3]! / 1000;
    if (ads[4] !== undefined) attrs.externalVoltage = ads[4]! / 1000;
  }
  return attrs;
}

interface ParsedFrame {
  imei: string;
  cmd: string;
  parts: string[]; // payload split by ','
}

/** Splits a Meitrack frame body (no `$$`, no `*XX\r\n`). */
function parseBody(body: string): ParsedFrame | null {
  // body: <flag><length>,<imei>,<cmd>,<payload>
  const firstComma = body.indexOf(',');
  if (firstComma < 2) return null;
  const remainder = body.slice(firstComma + 1);
  const parts = remainder.split(',');
  const imei = parts[0];
  const cmd = parts[1];
  if (!imei || !/^\d{6,17}$/.test(imei) || !cmd) return null;
  return { imei, cmd, parts: parts.slice(2) };
}

export class MeitrackDecoder implements Decoder {
  readonly protocol = 'meitrack';

  canDecode(buffer: Buffer): boolean {
    return buffer.length >= 2 && buffer[0] === FRAME_START_0 && buffer[1] === FRAME_START_0;
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;

    while (offset < buffer.length - 1) {
      // Find next "$$".
      let start = -1;
      for (let i = offset; i < buffer.length - 1; i++) {
        if (buffer[i] === FRAME_START_0 && buffer[i + 1] === FRAME_START_0) {
          start = i;
          break;
        }
      }
      if (start === -1) {
        offset = buffer.length;
        break;
      }

      // Locate the terminating \r\n after start.
      const termIdx = buffer.indexOf(FRAME_TERM, start + 2);
      if (termIdx === -1) {
        offset = start; // partial frame; wait for more data
        break;
      }
      const frameEnd = termIdx + 2; // include CRLF
      const raw = Buffer.from(buffer.subarray(start, frameEnd));
      const text = raw.toString('ascii');

      // Locate '*XX\r\n' before the terminator.
      const starIdx = text.lastIndexOf('*', text.length - 3);
      if (starIdx === -1 || text.length - starIdx < 5) {
        offset = frameEnd;
        continue;
      }
      const provided = text.slice(starIdx + 1, starIdx + 3).toUpperCase();
      const expected = xorChecksum(raw, 0, starIdx);
      if (provided !== expected) {
        offset = frameEnd; // skip bad-checksum frame
        continue;
      }

      const body = text.slice(2, starIdx).replace(/,$/, ''); // strip "$$" and trailing comma before '*'
      const parsed = parseBody(body);
      if (parsed) {
        ctx.setImei(parsed.imei);
        messages.push(this.buildMessage(parsed, raw));
      }
      offset = frameEnd;
    }

    return { messages, consumed: offset };
  }

  private buildMessage(p: ParsedFrame, raw: Buffer): DecodedMessage {
    if (p.cmd === 'AAA') {
      const position = parsePosition(p.parts);
      const attributes = parseAttributes(p.parts);
      const eventCode = Number(p.parts[0] ?? 0);
      const event = EVENT_CODES[eventCode];
      if (position) {
        const isLocationEvent = event === 'track_by_time' || event === 'track_by_distance' || event === undefined;
        return {
          protocol: this.protocol,
          kind: isLocationEvent ? 'location' : 'alarm',
          imei: p.imei,
          position,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
          alarmType: isLocationEvent ? undefined : event,
          raw,
        };
      }
    }
    // Plain keepalive / unknown commands: surface as heartbeat to keep the link alive.
    return { protocol: this.protocol, kind: 'heartbeat', imei: p.imei, raw, meta: { cmd: p.cmd } };
  }
}
