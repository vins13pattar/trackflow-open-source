import { describe, expect, it } from 'vitest';
import { crc16IBM } from '../base/crc.js';
import { SessionContext } from '../base/registry.js';
import { MAX_TELTONIKA_DATA_LENGTH, TeltonikaDecoder } from './index.js';
import { encodeTeltonikaAvl, encodeTeltonikaCommand, encodeTeltonikaImei, parseTeltonikaCommandResponse } from './encode.js';

describe('Teltonika CRC-16/IBM', () => {
  it('matches the canonical ARC check value for "123456789"', () => {
    expect(crc16IBM(Buffer.from('123456789', 'ascii'))).toBe(0xbb3d);
  });
});

describe('Teltonika Codec 8', () => {
  const IMEI = '356307042441013';

  it('rejects oversized and truncated attacker-controlled frames without throwing', () => {
    const decoder = new TeltonikaDecoder();
    const ctx = new SessionContext();
    ctx.setImei(IMEI);

    const oversized = Buffer.alloc(12);
    oversized.writeUInt32BE(0, 0);
    oversized.writeUInt32BE(MAX_TELTONIKA_DATA_LENGTH + 1, 4);
    expect(() => decoder.decode(oversized, ctx)).not.toThrow();

    // A valid outer CRC is not sufficient when a record advertises fields
    // beyond the body. Drop the malformed frame without a parser exception.
    const body = Buffer.from([0x08, 0x01, 0x00, 0x01]);
    const malformed = Buffer.alloc(8 + body.length + 4);
    malformed.writeUInt32BE(0, 0);
    malformed.writeUInt32BE(body.length, 4);
    body.copy(malformed, 8);
    malformed.writeUInt32BE(crc16IBM(body), 8 + body.length);
    expect(() => decoder.decode(malformed, ctx)).not.toThrow();
    expect(decoder.decode(malformed, ctx).messages).toHaveLength(0);
  });

  it('accepts the IMEI handshake with 0x01', () => {
    const ctx = new SessionContext();
    const result = new TeltonikaDecoder().decode(encodeTeltonikaImei(IMEI), ctx);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.kind).toBe('login');
    expect(result.messages[0]!.imei).toBe(IMEI);
    expect(ctx.imei).toBe(IMEI);
    expect(result.messages[0]!.reply!.equals(Buffer.from([0x01]))).toBe(true);
  });

  it('round-trips an AVL location packet and acks with the record count', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const time = new Date('2026-05-23T10:30:00.000Z');
    const frame = encodeTeltonikaAvl([
      { latitude: 54.7146, longitude: 25.2985, speedKph: 60, course: 180, satellites: 12, time },
    ]);
    const { messages } = new TeltonikaDecoder().decode(frame, ctx);
    expect(messages).toHaveLength(1);
    const pos = messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(54.7146, 4);
    expect(pos.longitude).toBeCloseTo(25.2985, 4);
    expect(pos.speedKph).toBe(60);
    expect(pos.course).toBe(180);
    expect(pos.satellites).toBe(12);
    expect(pos.fixTime.toISOString()).toBe('2026-05-23T10:30:00.000Z');
    expect(messages[0]!.reply!.readUInt32BE(0)).toBe(1);
  });

  it('extracts IO telemetry (ignition, voltages, temperature)', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const frame = encodeTeltonikaAvl([
      {
        latitude: 54.7,
        longitude: 25.3,
        ignition: true,
        gsmSignal: 4,
        externalVoltage: 13.8,
        batteryVoltage: 4.01,
        temperature: -5.5,
        batteryPercent: 87,
      },
    ]);
    const attrs = new TeltonikaDecoder().decode(frame, ctx).messages[0]!.attributes!;
    expect(attrs.ignition).toBe(true);
    expect(attrs.gsmSignal).toBe(4);
    expect(attrs.externalVoltage).toBeCloseTo(13.8, 2);
    expect(attrs.batteryVoltage).toBeCloseTo(4.01, 2);
    expect(attrs.temperature).toBeCloseTo(-5.5, 1);
    expect(attrs.batteryPercent).toBe(87);
  });

  it('handshake then multiple records in one session', () => {
    const ctx = new SessionContext();
    new TeltonikaDecoder().decode(encodeTeltonikaImei(IMEI), ctx);
    const frame = encodeTeltonikaAvl([
      { latitude: 12.97, longitude: 77.59, speedKph: 30 },
      { latitude: 12.98, longitude: 77.6, speedKph: 35 },
    ]);
    const { messages } = new TeltonikaDecoder().decode(frame, ctx);
    expect(messages).toHaveLength(2);
    expect(messages[1]!.reply!.readUInt32BE(0)).toBe(2);
  });

  it('rejects an AVL packet with a corrupted CRC', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const frame = encodeTeltonikaAvl([{ latitude: 1, longitude: 1 }]);
    frame.writeUInt16BE(0x0000, frame.length - 2);
    expect(new TeltonikaDecoder().decode(frame, ctx).messages).toHaveLength(0);
  });
});

describe('Teltonika OBD-II PIDs', () => {
  const IMEI = '352093085012345';

  it('decodes the standard OBD-II AVL IO IDs to canonical units', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    // Codec 8 stores RPM (PID 36) as 2-byte raw; coolant (32) as 1-byte raw
    // (°C + 40); speed (37) as km/h raw; throttle (41) scaled 0-255 → 0-100%.
    const frame = encodeTeltonikaAvl([
      {
        latitude: 12.97,
        longitude: 77.59,
        rawIo1: { 32: 130 /* 90°C */, 37: 60, 41: 128 /* ≈50% */ },
        rawIo2: { 36: 1800 },
      },
    ]);
    const messages = new TeltonikaDecoder().decode(frame, ctx).messages;
    expect(messages).toHaveLength(1);
    const attrs = messages[0]?.attributes ?? {};
    expect(attrs.obdCoolantTempC).toBe(90);
    expect(attrs.obdVehicleSpeedKph).toBe(60);
    expect(attrs.obdEngineRpm).toBe(1800);
    expect((attrs.obdThrottlePositionPct as number).toFixed(1)).toBe('50.2');
  });

  it('applies signed transforms (short fuel trim, timing advance, ambient temp)', () => {
    const ctx = new SessionContext();
    ctx.setImei(IMEI);
    const frame = encodeTeltonikaAvl([
      {
        latitude: 0,
        longitude: 0,
        // 33: -100..+99% (encoded value-100). 80 → -20% fuel trim.
        // 38: timing advance = encoded/2 - 64. 144 → 8° advance.
        // 53: ambient temp °C+40. 20 → -20°C.
        rawIo1: { 33: 80, 38: 144, 53: 20 },
      },
    ]);
    const messages = new TeltonikaDecoder().decode(frame, ctx).messages;
    const attrs = messages[0]?.attributes ?? {};
    expect(attrs.obdShortFuelTrimPct).toBe(-20);
    expect(attrs.obdTimingAdvanceDeg).toBe(8);
    expect(attrs.obdAmbientAirTempC).toBe(-20);
  });
});

describe('Teltonika Codec 12 (commands)', () => {
  it('encodes a request with the documented wire shape', () => {
    const frame = encodeTeltonikaCommand('getstatus');
    // preamble + dataLen + body + crc(4)
    expect(frame.readUInt32BE(0)).toBe(0);
    const dataLen = frame.readUInt32BE(4);
    const body = frame.subarray(8, 8 + dataLen);
    expect(body[0]).toBe(0x0c); // codec id
    expect(body[1]).toBe(0x01); // command count
    expect(body[2]).toBe(0x05); // request type
    expect(body.readUInt32BE(3)).toBe('getstatus'.length); // payload size
    expect(body.subarray(7, 7 + 'getstatus'.length).toString('ascii')).toBe('getstatus');
    expect(body[body.length - 1]).toBe(0x01); // trailing count
    // CRC at the tail covers the body.
    expect(frame.readUInt32BE(8 + dataLen)).toBe(crc16IBM(body));
  });

  it('round-trips a response: take the encoded request, flip type to 0x06, parse it back', () => {
    const request = encodeTeltonikaCommand('Coordinates Available');
    // Re-build it as a response frame (CMD type 0x06 instead of 0x05).
    const dataLen = request.readUInt32BE(4);
    const body = Buffer.from(request.subarray(8, 8 + dataLen));
    body[2] = 0x06;
    const out = Buffer.alloc(4 + 4 + body.length + 4);
    out.writeUInt32BE(0, 0);
    out.writeUInt32BE(body.length, 4);
    body.copy(out, 8);
    out.writeUInt32BE(crc16IBM(body), 8 + body.length);

    const parsed = parseTeltonikaCommandResponse(out);
    expect(parsed?.command).toBe('Coordinates Available');
  });

  it('rejects truncated / bad-CRC frames (returns null)', () => {
    expect(parseTeltonikaCommandResponse(Buffer.from([0, 0, 0, 0]))).toBeNull();
    const valid = encodeTeltonikaCommand('ping');
    const dataLen = valid.readUInt32BE(4);
    const body = Buffer.from(valid.subarray(8, 8 + dataLen));
    body[2] = 0x06; // response
    const bad = Buffer.alloc(4 + 4 + body.length + 4);
    bad.writeUInt32BE(0, 0);
    bad.writeUInt32BE(body.length, 4);
    body.copy(bad, 8);
    bad.writeUInt32BE(0xdeadbeef, 8 + body.length); // wrong CRC
    expect(parseTeltonikaCommandResponse(bad)).toBeNull();
  });
});
