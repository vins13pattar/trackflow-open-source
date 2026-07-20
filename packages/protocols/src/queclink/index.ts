/**
 * Queclink decoder — the ASCII protocol used by Quectel/Queclink trackers
 * (GV300W, GL300, GV55, etc).
 *
 * Frames are ASCII, start with one of three prefixes and end with `$`:
 *   +RESP:GTxxx,...,$   — server-bound report
 *   +BUFF:GTxxx,...,$   — buffered report (delivered when comms restore)
 *   +ACK:GTxxx,...,$    — device-initiated heartbeat/acknowledgement
 *
 * Field layout (Queclink @Track Air Interface Protocol, Reports):
 *   GTFRI: <type>,<protoVer>,<imei>,<deviceName>,<reportId>,<reportCount>,
 *          <position#>,<gpsAccuracy>,<speed>,<course>,<altitude>,<lon>,<lat>,
 *          <gpsUtcTime YYYYMMDDhhmmss>,<mcc>,<mnc>,<lac>,<cellId>,<reserved>,
 *          <odometer>,<hourMeter>,<analog1>,<analog2>,<sendTime>,<count>
 *
 * Server reply: +SACK:<type>,<protoVer>,<count>$ — confirms a +ACK.
 */
import type {
  Attributes,
  DecodeContext,
  DecodeResult,
  DecodedMessage,
  Decoder,
  Position,
} from '../base/types.js';

const FRAME_END = 0x24; // '$'

function parseUtc(yyyymmddhhmmss: string): Date | null {
  if (yyyymmddhhmmss.length < 14) return null;
  const y = Number(yyyymmddhhmmss.slice(0, 4));
  const mo = Number(yyyymmddhhmmss.slice(4, 6));
  const d = Number(yyyymmddhhmmss.slice(6, 8));
  const h = Number(yyyymmddhhmmss.slice(8, 10));
  const mi = Number(yyyymmddhhmmss.slice(10, 12));
  const s = Number(yyyymmddhhmmss.slice(12, 14));
  if (![y, mo, d, h, mi, s].every(Number.isFinite)) return null;
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Maps a Queclink alarm message type to our normalised alarm label. */
const ALARM_TYPES: Record<string, string> = {
  GTSOS: 'sos',
  GTHBM: 'harsh_braking', // harsh behaviour: braking
  GTSPD: 'overspeed',
  GTBPL: 'low_battery',
  GTBTC: 'battery_charging',
  GTSTC: 'battery_full',
  GTPNA: 'power_on',
  GTPFA: 'power_off',
  GTMPN: 'main_power_on',
  GTMPF: 'main_power_off',
  GTTOW: 'tow',
  GTIDN: 'idle',
  GTIDF: 'idle_end',
  GTSTR: 'engine_start',
  GTSTP: 'engine_stop',
  GTGEO: 'geofence',
  GTRTL: 'request_location_response',
};

/** Reports that carry a GTFRI-style location block at the same offset. */
const LOCATION_REPORTS = new Set([
  'GTFRI', // fixed report (regular ping)
  'GTGEO', // geofence event report
  'GTSPD', // overspeed
  'GTSOS', // SOS button
  'GTRTL', // requested location
  'GTBPL', // low battery (carries last position)
  'GTSTR', // engine start
  'GTSTP', // engine stop
  'GTHBM', // harsh-behaviour
]);

interface ParsedHead {
  prefix: 'RESP' | 'BUFF' | 'ACK';
  type: string;
  protoVer: string;
  imei: string;
  fields: string[];
}

/** Parses the head of a Queclink frame: returns prefix/type/imei + remaining fields. */
function splitHead(text: string): ParsedHead | null {
  // text shape: "+PFX:TYPE,protoVer,imei,deviceName,..."
  const colon = text.indexOf(':');
  if (colon < 2) return null;
  const prefix = text.slice(1, colon);
  if (prefix !== 'RESP' && prefix !== 'BUFF' && prefix !== 'ACK') return null;
  const parts = text.slice(colon + 1).split(',');
  const type = parts[0];
  const protoVer = parts[1];
  const imei = parts[2];
  if (!type || !protoVer || !imei || !/^\d{6,17}$/.test(imei)) return null;
  return { prefix: prefix as 'RESP' | 'BUFF' | 'ACK', type, protoVer, imei, fields: parts };
}

/** Parses a GTFRI-style location block.
 *  Returns null when the frame is too short to carry one. */
function parseGtfriPosition(fields: string[]): Position | null {
  // Indices into the comma-separated payload (after the colon):
  // 0:type 1:protoVer 2:imei 3:deviceName 4:reportId 5:reportCount
  // 6:position# 7:gpsAccuracy 8:speed 9:course 10:altitude 11:lon 12:lat
  // 13:gpsUtcTime
  if (fields.length < 14) return null;
  const speedKph = num(fields[8]);
  const course = num(fields[9]);
  const longitude = num(fields[11]);
  const latitude = num(fields[12]);
  const fixTime = parseUtc(fields[13] ?? '');
  if (longitude === undefined || latitude === undefined || !fixTime) return null;
  const accuracy = num(fields[7]);
  return {
    latitude,
    longitude,
    speedKph: speedKph ?? 0,
    course: course ?? 0,
    // gpsAccuracy >0 means a real fix; 0 typically means "no fix, last known".
    gpsValid: accuracy !== undefined ? accuracy > 0 : true,
    fixTime,
  };
}

function parseGtfriAttributes(fields: string[]): Attributes {
  // Many Queclink reports carry an odometer, hour meter and analog inputs after
  // the position block, ending with sendTime + countNumber. Indices 19-23.
  const attrs: Attributes = {};
  const odo = num(fields[19]);
  if (odo !== undefined) attrs.odometer = odo; // km, already canonical
  const hourMeter = num(fields[20]);
  if (hourMeter !== undefined) attrs.hourMeter = hourMeter;
  // Queclink encodes the analog values as the volt × 1000 hex/dec; we keep them
  // as numbers and let consumers decide what they represent on this device.
  const a1 = num(fields[21]);
  if (a1 !== undefined) attrs.analogInput1Mv = a1;
  const a2 = num(fields[22]);
  if (a2 !== undefined) attrs.analogInput2Mv = a2;
  return attrs;
}

/** Server-bound ACK for a heartbeat: +SACK:GTHBD,<protoVer>,<count>$. */
function buildSack(head: ParsedHead): Buffer {
  const count = head.fields[head.fields.length - 1] ?? '0000';
  return Buffer.from(`+SACK:${head.type},${head.protoVer},${count}$`, 'ascii');
}

export class QueclinkDecoder implements Decoder {
  readonly protocol = 'queclink';

  canDecode(buffer: Buffer): boolean {
    if (buffer.length < 6) return false;
    // Cheap shape check: "+RESP:" / "+BUFF:" / "+ACK:".
    if (buffer[0] !== 0x2b) return false; // '+'
    const head = buffer.subarray(0, Math.min(buffer.length, 6)).toString('ascii');
    return head.startsWith('+RESP:') || head.startsWith('+BUFF:') || head.startsWith('+ACK:');
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      const start = buffer.indexOf(0x2b, offset); // '+'
      if (start === -1) {
        offset = buffer.length;
        break;
      }
      const end = buffer.indexOf(FRAME_END, start + 1);
      if (end === -1) {
        offset = start; // partial frame; caller buffers and retries
        break;
      }
      const raw = Buffer.from(buffer.subarray(start, end + 1));
      const text = raw.toString('ascii');
      const head = splitHead(text.slice(0, text.length - 1)); // strip trailing '$'
      if (head) {
        ctx.setImei(head.imei);
        messages.push(this.buildMessage(head, raw));
      }
      offset = end + 1;
    }
    return { messages, consumed: offset };
  }

  private buildMessage(head: ParsedHead, raw: Buffer): DecodedMessage {
    // Heartbeat (device-initiated keep-alive). Reply with +SACK so the device
    // knows the link is alive; no position attached.
    if (head.prefix === 'ACK' && head.type === 'GTHBD') {
      return {
        protocol: this.protocol,
        kind: 'heartbeat',
        imei: head.imei,
        raw,
        reply: buildSack(head),
      };
    }

    if (LOCATION_REPORTS.has(head.type)) {
      const position = parseGtfriPosition(head.fields);
      const attributes = parseGtfriAttributes(head.fields);
      const alarmType = ALARM_TYPES[head.type];
      if (position) {
        return {
          protocol: this.protocol,
          kind: alarmType && alarmType !== 'request_location_response' ? 'alarm' : 'location',
          imei: head.imei,
          position,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
          alarmType,
          raw,
        };
      }
    }

    // Power on/off come without a position block — surface them as status alarms.
    if (head.type === 'GTPNA' || head.type === 'GTPFA') {
      return {
        protocol: this.protocol,
        kind: 'alarm',
        imei: head.imei,
        alarmType: ALARM_TYPES[head.type],
        raw,
      };
    }

    return { protocol: this.protocol, kind: 'unknown', imei: head.imei, raw, meta: { type: head.type } };
  }
}
