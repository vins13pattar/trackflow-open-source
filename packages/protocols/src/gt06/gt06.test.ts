import { describe, expect, it } from 'vitest';
import { crc16ITU } from '../base/crc.js';
import { SessionContext } from '../base/registry.js';
import { Gt06Decoder } from './index.js';
import { encodeGt06Command, encodeGt06Location, encodeGt06Login, encodeGt06Status, parseGt06CommandResponse } from './encode.js';

// NOTE: the PRD's literal sample bytes (and their `8CDD` checksum) are
// illustrative/fabricated — the "IMEI" 0001523487654321 isn't a real one and
// the checksum doesn't match any standard algorithm. The authoritative oracle
// is the canonical CRC-16/X-25 check value, which is exactly GT06's "CRC-ITU".
const IMEI = '865432019876543';

describe('GT06 CRC-ITU (CRC-16/X-25)', () => {
  it('matches the canonical X-25 check value for "123456789"', () => {
    expect(crc16ITU(Buffer.from('123456789', 'ascii'))).toBe(0x906e);
  });
});

describe('GT06 encoder + decoder round-trip', () => {
  it('builds a structurally valid login frame that decodes back to the IMEI', () => {
    const frame = encodeGt06Login(IMEI, 1);
    // 7878 | len | 01 | imei(8) | serial(2) | crc(2) | 0D0A
    expect(frame.readUInt16BE(0)).toBe(0x7878);
    expect(frame.readUInt8(2)).toBe(0x0d); // len = 13
    expect(frame.readUInt8(3)).toBe(0x01); // login protocol
    expect(frame.subarray(frame.length - 2).toString('hex')).toBe('0d0a');

    const ctx = new SessionContext();
    const result = new Gt06Decoder().decode(frame, ctx);
    expect(result.consumed).toBe(frame.length);
    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0]!;
    expect(msg.kind).toBe('login');
    expect(msg.imei).toBe(IMEI);
    expect(ctx.imei).toBe(IMEI);
    // ACK echoes protocol 0x01 with the same serial.
    expect(msg.reply).toBeDefined();
    expect(msg.reply!.readUInt8(3)).toBe(0x01);
    expect(msg.reply!.readUInt16BE(4)).toBe(1);
  });

  it('round-trips a location frame', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const time = new Date('2026-02-15T10:30:00Z');
    const frame = encodeGt06Location(
      { latitude: 22.5761, longitude: 88.2058, speedKph: 46, course: 180, time },
      5,
    );
    const { messages } = new Gt06Decoder().decode(frame, ctx);
    expect(messages).toHaveLength(1);
    const pos = messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(22.5761, 3);
    expect(pos.longitude).toBeCloseTo(88.2058, 3);
    expect(pos.speedKph).toBe(46);
    expect(pos.course).toBe(180);
    expect(pos.gpsValid).toBe(true);
    expect(pos.fixTime.toISOString()).toBe('2026-02-15T10:30:00.000Z');
  });

  it('handles southern/western hemispheres', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const frame = encodeGt06Location({ latitude: -33.8688, longitude: -70.6, course: 90 }, 6);
    const pos = new Gt06Decoder().decode(frame, ctx).messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(-33.8688, 3);
    expect(pos.longitude).toBeCloseTo(-70.6, 3);
  });
});

describe('GT06 stream framing', () => {
  it('decodes two concatenated frames in one read', () => {
    const ctx = new SessionContext();
    const stream = Buffer.concat([
      encodeGt06Login(IMEI, 1),
      encodeGt06Location({ latitude: 12.97, longitude: 77.59 }, 2),
    ]);
    const result = new Gt06Decoder().decode(stream, ctx);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.kind).toBe('login');
    expect(result.messages[1]!.kind).toBe('location');
    expect(result.consumed).toBe(stream.length);
  });

  it('decodes status/heartbeat telemetry (ignition, battery, signal)', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const frame = encodeGt06Status({ ignition: true, charging: true, voltageLevel: 6, gsmSignal: 3 }, 7);
    const msg = new Gt06Decoder().decode(frame, ctx).messages[0]!;
    expect(msg.kind).toBe('heartbeat');
    expect(msg.attributes).toMatchObject({ ignition: true, charging: true, gsmSignal: 3, batteryPercent: 100 });
  });

  it('waits for more bytes on a partial frame', () => {
    const ctx = new SessionContext();
    const full = encodeGt06Login(IMEI, 1);
    const partial = full.subarray(0, full.length - 3);
    const result = new Gt06Decoder().decode(partial, ctx);
    expect(result.messages).toHaveLength(0);
    expect(result.consumed).toBe(0); // nothing consumed; caller retains the bytes
  });

  it('rejects a frame with a corrupted CRC', () => {
    const ctx = new SessionContext();
    const bad = encodeGt06Login(IMEI, 1);
    bad.writeUInt16BE(0x0000, bad.length - 4); // clobber the CRC
    const result = new Gt06Decoder().decode(bad, ctx);
    expect(result.messages).toHaveLength(0);
  });
});

describe('GT06 server-to-device command encoding', () => {
  it('produces a structurally valid 0x80 command frame', () => {
    const frame = encodeGt06Command('RELAY,1#', 1, 0);
    expect(frame.readUInt16BE(0)).toBe(0x7878); // start bytes
    expect(frame.readUInt8(3)).toBe(0x80); // protocol
    expect(frame.readUInt8(4)).toBe(0x02); // language = English
    expect(frame[frame.length - 2]).toBe(0x0d);
    expect(frame[frame.length - 1]).toBe(0x0a);
  });

  it('encodes the command ASCII payload correctly', () => {
    const cmd = 'RELAY,1#';
    const frame = encodeGt06Command(cmd, 5, 0xaabbccdd);
    // serverFlag at bytes 5–8
    expect(frame.readUInt32BE(5)).toBe(0xaabbccdd);
    // command bytes follow the serverFlag
    const cmdBytes = frame.subarray(9, 9 + cmd.length);
    expect(cmdBytes.toString('ascii')).toBe(cmd);
  });

  it('parses a protocol-0x15 command response', () => {
    // Build a realistic response: 78 78 | len | 15 | serverFlag(4) | "OK" | serial(2) | crc(2) | 0D 0A
    const serverFlag = 0x00000001;
    const responseStr = 'OK';
    const responseBuf = Buffer.from(responseStr, 'ascii');
    // Body = protocol(1=0x15) + serverFlag(4) + response + serial(2)
    const bodyLen = 1 + 4 + responseBuf.length + 2;
    const len = bodyLen + 2; // body + crc(2)
    const crcInput = Buffer.alloc(1 + bodyLen);
    crcInput.writeUInt8(len, 0);
    crcInput.writeUInt8(0x15, 1);
    crcInput.writeUInt32BE(serverFlag, 2);
    responseBuf.copy(crcInput, 6);
    crcInput.writeUInt16BE(1, 6 + responseBuf.length); // serial = 1
    const crc = crc16ITU(crcInput);
    const frame = Buffer.alloc(2 + 1 + bodyLen + 2 + 2);
    let off = 0;
    frame.writeUInt16BE(0x7878, off); off += 2;
    frame.writeUInt8(len, off++);
    frame.writeUInt8(0x15, off++);
    frame.writeUInt32BE(serverFlag, off); off += 4;
    responseBuf.copy(frame, off); off += responseBuf.length;
    frame.writeUInt16BE(1, off); off += 2; // serial
    frame.writeUInt16BE(crc, off); off += 2;
    frame.writeUInt8(0x0d, off++);
    frame.writeUInt8(0x0a, off++);

    const result = parseGt06CommandResponse(frame);
    expect(result).not.toBeNull();
    expect(result!.serverFlag).toBe(serverFlag);
    expect(result!.response).toBe(responseStr);
  });

  it('returns null for a truncated response frame', () => {
    const frame = encodeGt06Command('RELAY,0#', 1);
    expect(parseGt06CommandResponse(frame.subarray(0, 5))).toBeNull();
  });

  it('returns null when protocol byte is not 0x15', () => {
    const frame = encodeGt06Login(IMEI, 1);
    expect(parseGt06CommandResponse(frame)).toBeNull();
  });
});
