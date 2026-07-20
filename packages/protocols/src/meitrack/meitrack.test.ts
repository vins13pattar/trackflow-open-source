import { describe, expect, it } from 'vitest';
import { SessionContext } from '../base/registry.js';
import { MeitrackDecoder, xorChecksum } from './index.js';
import { encodeMeitrackLocation } from './encode.js';

describe('Meitrack XOR checksum', () => {
  it('computes upper-case 2-hex of bytewise XOR', () => {
    expect(xorChecksum(Buffer.from([0x01, 0x02, 0x03]))).toBe('00');
    expect(xorChecksum(Buffer.from('A'))).toBe('41');
  });
});

describe('Meitrack decoder (AAA)', () => {
  const IMEI = '353358017784062';

  it('round-trips a track-by-time location frame', () => {
    const ctx = new SessionContext();
    const time = new Date('2026-03-15T11:22:33.000Z');
    const frame = encodeMeitrackLocation({
      imei: IMEI,
      latitude: 22.913001,
      longitude: 114.079057,
      speedKph: 60,
      course: 221,
      satellites: 7,
      gsmSignal: 17,
      hdop: 1.5,
      altitude: 30,
      odometerKm: 12,
      runtimeSec: 86_400,
      ioStateHex: '0001',
      batteryVoltage: 4.05,
      externalVoltage: 12.6,
      time,
    });
    const decoder = new MeitrackDecoder();
    expect(decoder.canDecode(frame)).toBe(true);
    const { messages } = decoder.decode(frame, ctx);
    expect(messages).toHaveLength(1);
    const m = messages[0]!;
    expect(m.kind).toBe('location');
    expect(m.imei).toBe(IMEI);
    expect(ctx.imei).toBe(IMEI);
    expect(m.position!.latitude).toBeCloseTo(22.913001, 5);
    expect(m.position!.longitude).toBeCloseTo(114.079057, 5);
    expect(m.position!.speedKph).toBe(60);
    expect(m.position!.course).toBe(221);
    expect(m.position!.gpsValid).toBe(true);
    expect(m.position!.satellites).toBe(7);
    expect(m.position!.fixTime.toISOString()).toBe('2026-03-15T11:22:33.000Z');
    expect(m.attributes!.gsmSignal).toBe(17);
    expect(m.attributes!.hdop).toBeCloseTo(1.5, 2);
    expect(m.attributes!.altitude).toBe(30);
    expect(m.attributes!.odometer).toBe(12);
    expect(m.attributes!.runtimeSec).toBe(86_400);
    expect(m.attributes!.ioState).toBe('0001');
    expect(m.attributes!.batteryVoltage).toBeCloseTo(4.05, 2);
    expect(m.attributes!.externalVoltage).toBeCloseTo(12.6, 2);
  });

  it('classifies known event codes as alarms (SOS=1, low_battery=17, overspeed=19)', () => {
    const ctx = new SessionContext();
    const decoder = new MeitrackDecoder();
    for (const { code, alarm } of [
      { code: 1, alarm: 'sos' },
      { code: 17, alarm: 'low_battery' },
      { code: 19, alarm: 'overspeed' },
      { code: 20, alarm: 'enter_geofence' },
      { code: 21, alarm: 'exit_geofence' },
      { code: 40, alarm: 'harsh_braking' },
    ]) {
      const frame = encodeMeitrackLocation({
        imei: IMEI,
        latitude: 1,
        longitude: 2,
        eventCode: code,
      });
      const m = decoder.decode(frame, ctx).messages[0]!;
      expect(m.kind).toBe('alarm');
      expect(m.alarmType).toBe(alarm);
    }
  });

  it('rejects a frame with a corrupted XOR checksum', () => {
    const ctx = new SessionContext();
    const frame = encodeMeitrackLocation({ imei: IMEI, latitude: 1, longitude: 1 });
    // Corrupt the `*XX` checksum (two bytes before CRLF).
    frame[frame.length - 4] = 0x30; // '0'
    frame[frame.length - 3] = 0x30; // '0'
    expect(new MeitrackDecoder().decode(frame, ctx).messages).toHaveLength(0);
  });

  it('parses two concatenated frames in one TCP read', () => {
    const ctx = new SessionContext();
    const a = encodeMeitrackLocation({ imei: IMEI, latitude: 1.1, longitude: 2.2, time: new Date('2026-01-01T00:00:00Z') });
    const b = encodeMeitrackLocation({ imei: IMEI, latitude: 3.3, longitude: 4.4, time: new Date('2026-01-01T00:00:30Z') });
    const concat = Buffer.concat([a, b]);
    const { messages, consumed } = new MeitrackDecoder().decode(concat, ctx);
    expect(consumed).toBe(concat.length);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.position!.latitude).toBeCloseTo(1.1, 5);
    expect(messages[1]!.position!.latitude).toBeCloseTo(3.3, 5);
  });

  it('keeps a partial trailing frame (consumed reflects parsed bytes only)', () => {
    const ctx = new SessionContext();
    const full = encodeMeitrackLocation({ imei: IMEI, latitude: 1, longitude: 2 });
    // Append a truncated next frame (no CRLF).
    const partial = Buffer.concat([full, Buffer.from('$$A100,353358017784062,AAA,35,1.0,2.0,', 'ascii')]);
    const { messages, consumed } = new MeitrackDecoder().decode(partial, ctx);
    expect(messages).toHaveLength(1);
    expect(consumed).toBe(full.length);
  });

  it('rejects non-Meitrack data via canDecode()', () => {
    const decoder = new MeitrackDecoder();
    expect(decoder.canDecode(Buffer.from('+RESP:GTFRI'))).toBe(false);
    expect(decoder.canDecode(Buffer.from('*HQ,123,V1'))).toBe(false);
    expect(decoder.canDecode(Buffer.from('$$A28,'))).toBe(true);
  });
});
