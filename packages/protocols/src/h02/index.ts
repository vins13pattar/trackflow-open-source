/**
 * H02 decoder — a simple ASCII protocol used by many budget trackers.
 *
 * Frame: *HQ,<imei>,<cmd>,<fields...>#
 * Location (V1) fields:
 *   time(HHMMSS), valid(A/V), lat(ddmm.mmmm), N/S, lon(dddmm.mmmm), E/W,
 *   speed(knots), course(deg), date(DDMMYY), status(hex)
 */
import type {
  DecodeContext,
  DecodeResult,
  DecodedMessage,
  Decoder,
  Position,
} from '../base/types.js';

const FRAME_START = 0x2a; // '*'
const FRAME_END = 0x23; // '#'
const KNOTS_TO_KPH = 1.852;

function parseCoord(value: string, hemisphere: string): number {
  // ddmm.mmmm (lat) or dddmm.mmmm (lon): split degrees from minutes.
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return Number.NaN;
  const degrees = Math.floor(num / 100);
  const minutes = num - degrees * 100;
  let result = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') result = -result;
  return result;
}

function parseDateTime(time: string, date: string): Date {
  // time HHMMSS, date DDMMYY (both UTC).
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2, 4));
  const ss = Number(time.slice(4, 6));
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const year = 2000 + Number(date.slice(4, 6));
  return new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
}

function parseLocation(fields: string[]): Position | null {
  // fields[0]=imei is stripped by caller; here fields start at cmd.
  // [cmd, time, valid, lat, ns, lon, ew, speed, course, date, status...]
  if (fields.length < 10) return null;
  const time = fields[1]!;
  const gpsValid = fields[2] === 'A';
  const latitude = parseCoord(fields[3]!, fields[4]!);
  const longitude = parseCoord(fields[5]!, fields[6]!);
  const speedKph = (Number.parseFloat(fields[7]!) || 0) * KNOTS_TO_KPH;
  const course = Number.parseFloat(fields[8]!) || 0;
  const fixTime = parseDateTime(time, fields[9]!);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, speedKph, course, gpsValid, fixTime };
}

export class H02Decoder implements Decoder {
  readonly protocol = 'h02';

  canDecode(buffer: Buffer): boolean {
    return buffer.length >= 3 && buffer[0] === FRAME_START && buffer[1] === 0x48 && buffer[2] === 0x51; // "*HQ"
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      const start = buffer.indexOf(FRAME_START, offset);
      if (start === -1) {
        offset = buffer.length; // nothing parseable; drop noise
        break;
      }
      const end = buffer.indexOf(FRAME_END, start + 1);
      if (end === -1) {
        offset = start; // partial frame; keep from '*' for the next read
        break;
      }

      const raw = buffer.subarray(start, end + 1);
      const text = raw.toString('ascii').replace(/^\*/, '').replace(/#$/, '');
      const parts = text.split(',');
      // parts: [HQ, imei, cmd, ...fields]
      if (parts.length >= 3 && parts[0] === 'HQ') {
        const imei = parts[1]!;
        ctx.setImei(imei);
        const cmd = parts[2]!;
        const fields = parts.slice(2); // cmd + location fields
        const msg = this.parseFrame(cmd, fields, imei, Buffer.from(raw));
        messages.push(msg);
      }

      offset = end + 1;
    }

    return { messages, consumed: offset };
  }

  private parseFrame(cmd: string, fields: string[], imei: string, raw: Buffer): DecodedMessage {
    if (cmd === 'V1' || cmd === 'V4') {
      const position = parseLocation(fields);
      if (position) {
        return { protocol: this.protocol, kind: 'location', imei, position, raw };
      }
    }
    if (cmd === 'NBR' || cmd === 'HTBT' || cmd === 'LINK') {
      return { protocol: this.protocol, kind: 'heartbeat', imei, raw };
    }
    return { protocol: this.protocol, kind: 'unknown', imei, raw, meta: { cmd } };
  }
}
