/**
 * GT06 frame encoders — used by the device simulator and round-trip tests.
 * These mirror the decoder so a frame encoded here decodes back to the same
 * values (and the login frame reproduces the PRD's documented sample bytes).
 */
import { crc16ITU } from '../base/crc.js';

const START = Buffer.from([0x78, 0x78]);
const STOP = Buffer.from([0x0d, 0x0a]);

function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value & 0xffff, 0);
  return b;
}

function frame(protocol: number, info: Buffer, serial: number): Buffer {
  const body = Buffer.concat([Buffer.from([protocol]), info, u16(serial)]);
  const len = body.length + 2; // + crc(2)
  const crc = crc16ITU(Buffer.concat([Buffer.from([len]), body]));
  return Buffer.concat([START, Buffer.from([len]), body, u16(crc), STOP]);
}

function encodeBcdImei(imei: string): Buffer {
  const padded = imei.padStart(16, '0');
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = (Number(padded[i * 2]) << 4) | Number(padded[i * 2 + 1]);
  }
  return buf;
}

export function encodeGt06Login(imei: string, serial = 1): Buffer {
  return frame(0x01, encodeBcdImei(imei), serial);
}

export interface Gt06LocationInput {
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  satellites?: number;
  gpsValid?: boolean;
  time?: Date;
}

export function encodeGt06Location(input: Gt06LocationInput, serial = 2): Buffer {
  const t = input.time ?? new Date();
  const speed = Math.round(input.speedKph ?? 0);
  const course = Math.round(input.course ?? 0);
  const sats = input.satellites ?? 9;
  const gpsValid = input.gpsValid ?? true;

  const info = Buffer.alloc(18);
  info.writeUInt8(t.getUTCFullYear() - 2000, 0);
  info.writeUInt8(t.getUTCMonth() + 1, 1);
  info.writeUInt8(t.getUTCDate(), 2);
  info.writeUInt8(t.getUTCHours(), 3);
  info.writeUInt8(t.getUTCMinutes(), 4);
  info.writeUInt8(t.getUTCSeconds(), 5);
  info.writeUInt8(0xc0 | (sats & 0x0f), 6); // high nibble = info length, low = sats
  info.writeUInt32BE(Math.round(Math.abs(input.latitude) * 1800000), 7);
  info.writeUInt32BE(Math.round(Math.abs(input.longitude) * 1800000), 11);
  info.writeUInt8(Math.min(255, speed), 15);

  let cs = course & 0x03ff;
  if (gpsValid) cs |= 0x1000;
  if (input.latitude >= 0) cs |= 0x0400; // north
  if (input.longitude < 0) cs |= 0x0800; // west
  info.writeUInt16BE(cs, 16);

  return frame(0x12, info, serial);
}

export interface Gt06StatusInput {
  ignition?: boolean;
  charging?: boolean;
  voltageLevel?: number; // 0-6
  gsmSignal?: number; // 0-4
}

/** Encodes a GT06 status/heartbeat (0x13) packet carrying terminal info. */
export function encodeGt06Status(s: Gt06StatusInput = {}, serial = 3): Buffer {
  let term = 0;
  if (s.ignition) term |= 0x02;
  if (s.charging) term |= 0x04;
  const info = Buffer.from([term, s.voltageLevel ?? 6, s.gsmSignal ?? 4, 0x00, 0x01]);
  return frame(0x13, info, serial);
}

/**
 * Encodes a GT06 server-to-device command frame (protocol 0x80).
 *
 * Frame layout: `78 78 | len | 80 | language(1=0x02 EN) | serverFlag(4) | cmd(ascii) | serial(2) | crc(2) | 0D 0A`
 *
 * The device echoes `serverFlag` back in its protocol-0x15 response so the
 * server can match the reply to the originating command.  Pass `serverFlag=0`
 * (the default) when you don't need correlation.
 *
 * Common commands (Concox/JimiIoT GT06N):
 *   `"RELAY,1#"` — immobilize (cut fuel relay)
 *   `"RELAY,0#"` — mobilize (restore fuel relay)
 *   `"WHERE#"`   — request immediate GPS fix
 *   `"RESET#"`   — reboot device
 *   `"INTERVAL,30#"` — set reporting interval to 30 s
 */
export function encodeGt06Command(command: string, serial = 1, serverFlag = 0): Buffer {
  const cmd = Buffer.from(command, 'ascii');
  const info = Buffer.alloc(1 + 4 + cmd.length);
  info.writeUInt8(0x02, 0); // language = English
  info.writeUInt32BE(serverFlag >>> 0, 1);
  cmd.copy(info, 5);
  return frame(0x80, info, serial);
}

export interface Gt06CommandResponse {
  serverFlag: number;
  response: string;
}

/**
 * Parses a GT06 protocol-0x15 (String Information) frame — the device's reply
 * to a 0x80 command.  Returns `null` if the frame is incomplete or invalid.
 *
 * Frame layout: `78 78 | len | 15 | serverFlag(4) | response(ascii) | serial(2) | crc(2) | 0D 0A`
 */
export function parseGt06CommandResponse(buf: Buffer): Gt06CommandResponse | null {
  if (buf.length < 10) return null;
  if (buf.readUInt16BE(0) !== 0x7878) return null;
  const len = buf.readUInt8(2);
  const totalLen = 2 + 1 + len + 2; // start(2) + len(1) + body(len) + stop(2)
  if (buf.length < totalLen) return null;
  if (buf[3] !== 0x15) return null; // not a string-info packet
  if (buf[totalLen - 2] !== 0x0d || buf[totalLen - 1] !== 0x0a) return null;
  // body = protocol(1) + content(len - 2 - 2) + serial(2) + crc(2)
  // CRC covers [len .. serial] — i.e. offset 2 .. (totalLen - 4 - 1)
  const crcInput = buf.subarray(2, totalLen - 4);
  const expectedCrc = crc16ITU(crcInput);
  const actualCrc = buf.readUInt16BE(totalLen - 4);
  if (expectedCrc !== actualCrc) return null;
  // content starts at offset 4 (after start+len+protocol), ends before serial+crc+stop
  const contentEnd = totalLen - 4 - 2; // subtract stop(2) + crc is already inside totalLen
  if (contentEnd < 4 + 4) return null; // need at least serverFlag(4)
  const serverFlag = buf.readUInt32BE(4);
  const response = buf.subarray(8, contentEnd).toString('ascii');
  return { serverFlag, response };
}
