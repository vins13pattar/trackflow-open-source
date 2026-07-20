/** Teltonika Codec 8 encoders for the simulator and round-trip tests. */
import { crc16IBM } from '../base/crc.js';

export function encodeTeltonikaImei(imei: string): Buffer {
  const ascii = Buffer.from(imei, 'ascii');
  const buf = Buffer.alloc(2 + ascii.length);
  buf.writeUInt16BE(ascii.length, 0);
  ascii.copy(buf, 2);
  return buf;
}

export interface TeltonikaRecordInput {
  latitude: number;
  longitude: number;
  speedKph?: number;
  course?: number;
  satellites?: number;
  altitude?: number;
  time?: Date;
  // Optional telemetry (encoded as the matching Teltonika AVL IO IDs).
  ignition?: boolean;
  gsmSignal?: number;
  batteryPercent?: number;
  externalVoltage?: number; // volts
  batteryVoltage?: number; // volts
  temperature?: number; // °C
  /** Raw 1-byte IO IDs → value, e.g. OBD-II PIDs (31, 32, ...). Bypasses the
   *  named transforms so tests + simulators can drive arbitrary AVL IO IDs. */
  rawIo1?: Record<number, number>;
  /** Raw 2-byte IO IDs → value. */
  rawIo2?: Record<number, number>;
}

function encodeRecord(r: TeltonikaRecordInput): Buffer {
  const head = Buffer.alloc(24); // timestamp(8)+priority(1)+lon(4)+lat(4)+alt(2)+angle(2)+sat(1)+speed(2)
  let p = 0;
  head.writeBigUInt64BE(BigInt((r.time ?? new Date()).getTime()), p);
  p += 8;
  head.writeUInt8(0, p); // priority
  p += 1;
  head.writeInt32BE(Math.round(r.longitude * 1e7), p);
  p += 4;
  head.writeInt32BE(Math.round(r.latitude * 1e7), p);
  p += 4;
  head.writeInt16BE(Math.round(r.altitude ?? 0), p);
  p += 2;
  head.writeUInt16BE(Math.round(r.course ?? 0), p);
  p += 2;
  head.writeUInt8(r.satellites ?? 10, p);
  p += 1;
  head.writeUInt16BE(Math.round(r.speedKph ?? 0), p);

  const io1: [number, number][] = [];
  const io2: [number, number][] = [];
  if (r.ignition !== undefined) io1.push([239, r.ignition ? 1 : 0]);
  if (r.gsmSignal !== undefined) io1.push([21, r.gsmSignal]);
  if (r.batteryPercent !== undefined) io1.push([113, r.batteryPercent]);
  if (r.externalVoltage !== undefined) io2.push([66, Math.round(r.externalVoltage * 1000)]);
  if (r.batteryVoltage !== undefined) io2.push([67, Math.round(r.batteryVoltage * 1000)]);
  if (r.temperature !== undefined) io2.push([72, Math.round(r.temperature * 10) & 0xffff]);
  if (r.rawIo1) for (const [id, v] of Object.entries(r.rawIo1)) io1.push([Number(id), v & 0xff]);
  if (r.rawIo2) for (const [id, v] of Object.entries(r.rawIo2)) io2.push([Number(id), v & 0xffff]);

  const b1 = Buffer.alloc(1 + io1.length * 2);
  b1.writeUInt8(io1.length, 0);
  io1.forEach(([id, v], i) => {
    b1.writeUInt8(id, 1 + i * 2);
    b1.writeUInt8(v & 0xff, 2 + i * 2);
  });
  const b2 = Buffer.alloc(1 + io2.length * 3);
  b2.writeUInt8(io2.length, 0);
  io2.forEach(([id, v], i) => {
    b2.writeUInt8(id, 1 + i * 3);
    b2.writeUInt16BE(v & 0xffff, 2 + i * 3);
  });

  return Buffer.concat([
    head,
    Buffer.from([0, io1.length + io2.length]), // event io id + total io count
    b1,
    b2,
    Buffer.from([0, 0]), // N4 count, N8 count
  ]);
}

export function encodeTeltonikaAvl(records: TeltonikaRecordInput[]): Buffer {
  const recordBufs = records.map(encodeRecord);
  const body = Buffer.concat([
    Buffer.from([0x08, records.length]), // codec id + count1
    ...recordBufs,
    Buffer.from([records.length]), // count2
  ]);
  const packet = Buffer.alloc(4 + 4 + body.length + 4);
  packet.writeUInt32BE(0, 0); // preamble
  packet.writeUInt32BE(body.length, 4); // data length
  body.copy(packet, 8);
  packet.writeUInt32BE(crc16IBM(body), 8 + body.length); // CRC-16/IBM in low 2 bytes
  return packet;
}

// ---------- Codec 12 (commands) ----------

const CODEC_12 = 0x0c;
const CMD_TYPE_REQUEST = 0x05;
const CMD_TYPE_RESPONSE = 0x06;

/**
 * Encodes a Codec 12 command frame the server pushes to a connected Teltonika
 * device: `preamble(4=0) | dataLen(4) | codec(1=0x0C) | count(1) | type(1=0x05)
 * | cmdSize(4) | cmdAscii(N) | count(1) | crc(4)`. The device replies with the
 * same layout but `type=0x06` and `cmdAscii` containing the result string
 * (returned by `parseTeltonikaCommandResponse`). The CRC-16/IBM covers
 * codecId..count2.
 */
export function encodeTeltonikaCommand(command: string): Buffer {
  const cmd = Buffer.from(command, 'ascii');
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(cmd.length, 0);
  const body = Buffer.concat([
    Buffer.from([CODEC_12, 0x01, CMD_TYPE_REQUEST]),
    sizeBuf,
    cmd,
    Buffer.from([0x01]),
  ]);
  const packet = Buffer.alloc(4 + 4 + body.length + 4);
  packet.writeUInt32BE(0, 0); // preamble
  packet.writeUInt32BE(body.length, 4);
  body.copy(packet, 8);
  packet.writeUInt32BE(crc16IBM(body), 8 + body.length);
  return packet;
}

export interface TeltonikaCommandResponse {
  command: string; // the response body the device sent back (ASCII)
}

/** Parses a Codec 12 command response from a device. Returns null if the frame
 *  isn't a complete Codec 12 response (caller should buffer + retry). */
export function parseTeltonikaCommandResponse(buf: Buffer): TeltonikaCommandResponse | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) !== 0) return null; // preamble
  const dataLen = buf.readUInt32BE(4);
  if (buf.length < 8 + dataLen + 4) return null;
  const body = buf.subarray(8, 8 + dataLen);
  if (body[0] !== CODEC_12) return null;
  // body: codec(1) | count(1) | type(1) | size(4) | ascii(size) | count(1)
  if (body[2] !== CMD_TYPE_RESPONSE) return null;
  const size = body.readUInt32BE(3);
  if (body.length < 3 + 4 + size + 1) return null;
  const command = body.subarray(7, 7 + size).toString('ascii');
  const expectedCrc = crc16IBM(body);
  if (expectedCrc !== buf.readUInt32BE(8 + dataLen)) return null;
  return { command };
}
