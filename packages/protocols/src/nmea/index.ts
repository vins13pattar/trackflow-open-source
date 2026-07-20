/**
 * NMEA 0183 decoder — the standard sentence format emitted by raw GPS modules
 * (and many DIY/IoT devices). Handles $--RMC (full fix) and $--GGA (position +
 * satellites). Sentences carry no device identity, so the IMEI must be bound by
 * the session (e.g. a preceding identification line); positions are emitted with
 * `ctx.imei` and only forwarded once it is known.
 */
import type { DecodeContext, DecodeResult, DecodedMessage, Decoder, Position } from '../base/types.js';

const KNOTS_TO_KPH = 1.852;

function parseCoord(value: string, hemisphere: string): number {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return Number.NaN;
  const degrees = Math.floor(num / 100);
  const minutes = num - degrees * 100;
  let result = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') result = -result;
  return result;
}

function checksumOk(body: string, expectedHex: string): boolean {
  let x = 0;
  for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i);
  return (x & 0xff) === Number.parseInt(expectedHex, 16);
}

export class NmeaDecoder implements Decoder {
  readonly protocol = 'nmea';

  canDecode(buffer: Buffer): boolean {
    if (buffer.length < 6 || buffer[0] !== 0x24) return false; // '$'
    const head = buffer.subarray(0, 6).toString('ascii');
    return /^\$G[A-Z]RMC|\$G[A-Z]GGA/.test(head);
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;
    while (true) {
      const nl = buffer.indexOf(0x0a, offset);
      if (nl === -1) break;
      const line = buffer.subarray(offset, nl).toString('ascii').trim();
      offset = nl + 1;
      const msg = this.parseLine(line, ctx);
      if (msg) messages.push(msg);
    }
    return { messages, consumed: offset };
  }

  private parseLine(line: string, ctx: DecodeContext): DecodedMessage | null {
    if (!line.startsWith('$')) return null;
    const star = line.indexOf('*');
    const body = star >= 0 ? line.slice(1, star) : line.slice(1);
    if (star >= 0 && !checksumOk(body, line.slice(star + 1))) return null;
    const parts = body.split(',');
    const type = parts[0] ?? '';
    if (type.endsWith('RMC')) return this.fromRmc(parts, ctx, line);
    if (type.endsWith('GGA')) return this.fromGga(parts, ctx, line);
    return null;
  }

  private fromRmc(parts: string[], ctx: DecodeContext, raw: string): DecodedMessage | null {
    const latitude = parseCoord(parts[3] ?? '', parts[4] ?? '');
    const longitude = parseCoord(parts[5] ?? '', parts[6] ?? '');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const position: Position = {
      latitude,
      longitude,
      speedKph: (Number.parseFloat(parts[7] ?? '0') || 0) * KNOTS_TO_KPH,
      course: Number.parseFloat(parts[8] ?? '0') || 0,
      gpsValid: parts[2] === 'A',
      fixTime: parseDateTime(parts[9] ?? '', parts[1] ?? ''),
    };
    return { protocol: this.protocol, kind: 'location', imei: ctx.imei, position, raw: Buffer.from(raw, 'ascii') };
  }

  private fromGga(parts: string[], ctx: DecodeContext, raw: string): DecodedMessage | null {
    const latitude = parseCoord(parts[2] ?? '', parts[3] ?? '');
    const longitude = parseCoord(parts[4] ?? '', parts[5] ?? '');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const position: Position = {
      latitude,
      longitude,
      speedKph: 0,
      course: 0,
      gpsValid: (Number.parseInt(parts[6] ?? '0', 10) || 0) > 0,
      fixTime: new Date(),
      satellites: Number.parseInt(parts[7] ?? '0', 10) || 0,
    };
    return { protocol: this.protocol, kind: 'location', imei: ctx.imei, position, raw: Buffer.from(raw, 'ascii') };
  }
}

function parseDateTime(date: string, time: string): Date {
  // date ddmmyy, time hhmmss(.sss) — both UTC.
  if (date.length < 6 || time.length < 6) return new Date();
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const year = 2000 + Number(date.slice(4, 6));
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2, 4));
  const ss = Number(time.slice(4, 6));
  return new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
}
