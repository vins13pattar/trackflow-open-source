/**
 * GT06 / GT06N decoder (Concox family) — the most common protocol in India.
 *
 * Frame (standard packet):
 *   78 78 | len(1) | protocol(1) | content... | serial(2) | crc(2) | 0D 0A
 * `len` counts protocol + content + serial + crc (i.e. everything except the
 * two start bytes, the len byte itself, and the two stop bytes).
 *
 * The CRC-ITU is computed over [len .. serial] (inclusive), excluding the CRC
 * and stop bytes.
 *
 * Decoded against the protocol spec and cross-checked with Traccar's open
 * decoder; the login CRC test vector is the sample from the TrackFlow PRD.
 */
import { crc16ITU } from '../base/crc.js';
import type {
  DecodeContext,
  DecodeResult,
  DecodedMessage,
  Decoder,
  Position,
} from '../base/types.js';

const START = 0x7878;
const STOP_0 = 0x0d;
const STOP_1 = 0x0a;

const PROTO = {
  LOGIN: 0x01,
  LOCATION: 0x12,
  HEARTBEAT: 0x13,
  STRING: 0x15,
  ALARM: 0x16,
  GPS_LBS_2: 0x22,
  ALARM_2: 0x26,
} as const;

/** Protocols the server must acknowledge so the device stops retransmitting. */
const ACK_PROTOCOLS = new Set<number>([PROTO.LOGIN, PROTO.HEARTBEAT, PROTO.ALARM, PROTO.ALARM_2]);

const ALARM_LABELS: Record<number, string> = {
  0x01: 'sos',
  0x02: 'power_cut',
  0x03: 'vibration',
  0x04: 'enter_fence',
  0x05: 'exit_fence',
  0x06: 'overspeed',
  0x09: 'low_battery',
  0x0e: 'low_battery',
};

function decodeBcdImei(slice: Buffer): string {
  let hex = '';
  for (const b of slice) hex += b.toString(16).padStart(2, '0');
  // Encoded as 0 + 15 IMEI digits across 8 BCD bytes; keep the last 15 digits.
  return hex.slice(Math.max(0, hex.length - 15));
}

function buildAck(protocol: number, serial: number): Buffer {
  // 78 78 | 05 | protocol | serial(2) | crc(2) | 0D 0A
  const body = Buffer.alloc(4);
  body.writeUInt8(0x05, 0);
  body.writeUInt8(protocol, 1);
  body.writeUInt16BE(serial, 2);
  const crc = crc16ITU(body);
  const frame = Buffer.alloc(4 + 4);
  frame.writeUInt16BE(START, 0);
  body.copy(frame, 2);
  frame.writeUInt16BE(crc, 6);
  return Buffer.concat([frame, Buffer.from([STOP_0, STOP_1])]);
}

function parsePosition(info: Buffer): Position {
  // info layout: datetime(6) | sat(1) | lat(4) | lon(4) | speed(1) | courseStatus(2) | ...
  const year = 2000 + info.readUInt8(0);
  const fixTime = new Date(
    Date.UTC(
      year,
      info.readUInt8(1) - 1,
      info.readUInt8(2),
      info.readUInt8(3),
      info.readUInt8(4),
      info.readUInt8(5),
    ),
  );
  const satellites = info.readUInt8(6) & 0x0f;
  let latitude = info.readUInt32BE(7) / 1800000;
  let longitude = info.readUInt32BE(11) / 1800000;
  const speedKph = info.readUInt8(15);
  const courseStatus = info.readUInt16BE(16);
  const course = courseStatus & 0x03ff;
  const gpsValid = (courseStatus & 0x1000) !== 0;
  // 0x0400 set => North (positive lat); 0x0800 set => West (negative lon).
  if ((courseStatus & 0x0400) === 0) latitude = -latitude;
  if ((courseStatus & 0x0800) !== 0) longitude = -longitude;
  return { latitude, longitude, speedKph, course, gpsValid, fixTime, satellites };
}

export class Gt06Decoder implements Decoder {
  readonly protocol = 'gt06';

  canDecode(buffer: Buffer): boolean {
    return buffer.length >= 2 && buffer.readUInt16BE(0) === START;
  }

  decode(buffer: Buffer, ctx: DecodeContext): DecodeResult {
    const messages: DecodedMessage[] = [];
    let offset = 0;

    while (buffer.length - offset >= 5) {
      // Resync to a start marker if we are misaligned.
      if (buffer.readUInt16BE(offset) !== START) {
        offset += 1;
        continue;
      }
      const len = buffer.readUInt8(offset + 2);
      const frameLen = len + 5; // start(2) + lenByte(1) + len + stop(2)
      if (buffer.length - offset < frameLen) break; // wait for more bytes

      const frame = buffer.subarray(offset, offset + frameLen);
      const crcPos = offset + len + 1; // start(2)+lenByte(1) => first content byte at offset+3
      const serialPos = crcPos - 2;
      const expectedCrc = buffer.readUInt16BE(crcPos);
      const actualCrc = crc16ITU(buffer.subarray(offset + 2, crcPos));

      if (expectedCrc !== actualCrc) {
        // Bad frame; skip the start marker and resync rather than dropping all.
        offset += 1;
        continue;
      }

      const protocol = buffer.readUInt8(offset + 3);
      const serial = buffer.readUInt16BE(serialPos);
      const info = buffer.subarray(offset + 4, serialPos);
      const msg = this.parseFrame(protocol, info, serial, Buffer.from(frame), ctx);
      if (msg) messages.push(msg);

      offset += frameLen;
    }

    return { messages, consumed: offset };
  }

  private parseFrame(
    protocol: number,
    info: Buffer,
    serial: number,
    raw: Buffer,
    ctx: DecodeContext,
  ): DecodedMessage | null {
    const reply = ACK_PROTOCOLS.has(protocol) ? buildAck(protocol, serial) : undefined;

    switch (protocol) {
      case PROTO.LOGIN: {
        const imei = decodeBcdImei(info.subarray(0, 8));
        ctx.setImei(imei);
        return { protocol: this.protocol, kind: 'login', imei, raw, reply };
      }
      case PROTO.LOCATION:
      case PROTO.GPS_LBS_2: {
        return {
          protocol: this.protocol,
          kind: 'location',
          imei: ctx.imei,
          position: parsePosition(info),
          raw,
          reply,
        };
      }
      case PROTO.ALARM:
      case PROTO.ALARM_2: {
        const position = parsePosition(info);
        // Alarm byte sits after the LBS block; offset varies by model, so we
        // best-effort read the documented terminal-info/alarm position.
        const alarmByte = info.length >= 32 ? info.readUInt8(31) : undefined;
        return {
          protocol: this.protocol,
          kind: 'alarm',
          imei: ctx.imei,
          position,
          alarmType: alarmByte !== undefined ? (ALARM_LABELS[alarmByte] ?? 'unknown') : undefined,
          raw,
          reply,
        };
      }
      case PROTO.HEARTBEAT: {
        // Status packet: terminalInfo(1), voltageLevel(1 of 0-6), gsmSignal(1 of 0-4), ...
        let attributes: Record<string, number | boolean> | undefined;
        if (info.length >= 3) {
          const term = info.readUInt8(0);
          const voltageLevel = info.readUInt8(1);
          const gsm = info.readUInt8(2);
          attributes = {
            ignition: (term & 0x02) !== 0, // ACC
            charging: (term & 0x04) !== 0,
            gsmSignal: gsm,
            batteryPercent: Math.round((Math.min(voltageLevel, 6) / 6) * 100),
          };
        }
        return { protocol: this.protocol, kind: 'heartbeat', imei: ctx.imei, attributes, raw, reply };
      }
      default:
        return { protocol: this.protocol, kind: 'unknown', imei: ctx.imei, raw, reply, meta: { protocol } };
    }
  }
}

// Exposed for the device simulator and tests.
export const gt06Internal = { crc16ITU, buildAck, decodeBcdImei, START };
