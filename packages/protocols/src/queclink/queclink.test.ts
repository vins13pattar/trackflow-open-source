import { describe, expect, it } from 'vitest';
import { SessionContext } from '../base/registry.js';
import { QueclinkDecoder } from './index.js';
import { encodeQueclinkHeartbeat, encodeQueclinkLocation, encodeQueclinkPower } from './encode.js';

describe('Queclink decoder', () => {
  const IMEI = '135790246811934';

  it('round-trips a GTFRI location frame', () => {
    const ctx = new SessionContext();
    const time = new Date('2026-04-12T08:15:30.000Z');
    const frame = encodeQueclinkLocation({
      imei: IMEI,
      latitude: 12.97612,
      longitude: 77.59456,
      speedKph: 42.5,
      course: 95,
      altitude: 920.5,
      odometer: 12345,
      hourMeter: 678,
      analogInput1Mv: 12800,
      time,
    });
    const decoder = new QueclinkDecoder();
    expect(decoder.canDecode(frame)).toBe(true);
    const { messages } = decoder.decode(frame, ctx);
    expect(messages).toHaveLength(1);
    const m = messages[0]!;
    expect(m.kind).toBe('location');
    expect(m.imei).toBe(IMEI);
    expect(ctx.imei).toBe(IMEI);
    expect(m.position!.latitude).toBeCloseTo(12.97612, 5);
    expect(m.position!.longitude).toBeCloseTo(77.59456, 5);
    expect(m.position!.speedKph).toBeCloseTo(42.5, 1);
    expect(m.position!.course).toBe(95);
    expect(m.position!.gpsValid).toBe(true);
    expect(m.position!.fixTime.toISOString()).toBe('2026-04-12T08:15:30.000Z');
    expect(m.attributes!.odometer).toBe(12345);
    expect(m.attributes!.hourMeter).toBe(678);
    expect(m.attributes!.analogInput1Mv).toBe(12800);
  });

  it('flags accuracy=0 as no-fix (gpsValid=false)', () => {
    const ctx = new SessionContext();
    const frame = encodeQueclinkLocation({
      imei: IMEI,
      latitude: 12.97,
      longitude: 77.59,
      accuracyM: 0,
      time: new Date('2026-04-12T08:15:30.000Z'),
    });
    const m = new QueclinkDecoder().decode(frame, ctx).messages[0]!;
    expect(m.position!.gpsValid).toBe(false);
  });

  it('emits a +SACK ACK for a GTHBD heartbeat', () => {
    const ctx = new SessionContext();
    const frame = encodeQueclinkHeartbeat({ imei: IMEI, count: '00A5' });
    const { messages } = new QueclinkDecoder().decode(frame, ctx);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.kind).toBe('heartbeat');
    expect(messages[0]!.reply!.toString('ascii')).toBe('+SACK:GTHBD,210901,00A5$');
  });

  it('classifies alarm frames (SOS, low battery, overspeed)', () => {
    const ctx = new SessionContext();
    const decoder = new QueclinkDecoder();
    for (const type of ['GTSOS', 'GTBPL', 'GTSPD'] as const) {
      const frame = encodeQueclinkLocation({ imei: IMEI, latitude: 1, longitude: 2, type });
      const m = decoder.decode(frame, ctx).messages[0]!;
      expect(m.kind).toBe('alarm');
      // Each maps to a recognizable normalized label.
      expect(m.alarmType).toBeTruthy();
    }
  });

  it('decodes GTPNA / GTPFA power events as power_on / power_off alarms', () => {
    const ctx = new SessionContext();
    const onFrame = encodeQueclinkPower({ imei: IMEI, on: true });
    const offFrame = encodeQueclinkPower({ imei: IMEI, on: false });
    const decoder = new QueclinkDecoder();
    expect(decoder.decode(onFrame, ctx).messages[0]!.alarmType).toBe('power_on');
    expect(decoder.decode(offFrame, ctx).messages[0]!.alarmType).toBe('power_off');
  });

  it('parses multiple concatenated frames in one TCP read', () => {
    const ctx = new SessionContext();
    const a = encodeQueclinkLocation({ imei: IMEI, latitude: 1.1, longitude: 2.2, time: new Date('2026-01-01T00:00:00Z') });
    const b = encodeQueclinkHeartbeat({ imei: IMEI, count: '0010' });
    const c = encodeQueclinkLocation({ imei: IMEI, latitude: 3.3, longitude: 4.4, time: new Date('2026-01-01T00:00:30Z') });
    const concat = Buffer.concat([a, b, c]);
    const { messages, consumed } = new QueclinkDecoder().decode(concat, ctx);
    expect(consumed).toBe(concat.length);
    expect(messages).toHaveLength(3);
    expect(messages[0]!.kind).toBe('location');
    expect(messages[1]!.kind).toBe('heartbeat');
    expect(messages[2]!.kind).toBe('location');
  });

  it('keeps a partial trailing frame in the input buffer (consumed reflects parsed bytes)', () => {
    const ctx = new SessionContext();
    const full = encodeQueclinkLocation({ imei: IMEI, latitude: 1, longitude: 2 });
    // Truncate before the closing '$'.
    const partial = Buffer.concat([full, Buffer.from('+RESP:GTFRI,210901,135790246811934,GV300W,', 'ascii')]);
    const { messages, consumed } = new QueclinkDecoder().decode(partial, ctx);
    expect(messages).toHaveLength(1);
    expect(consumed).toBe(full.length); // partial tail remains for the next read
  });

  it('rejects non-Queclink data via canDecode()', () => {
    const decoder = new QueclinkDecoder();
    expect(decoder.canDecode(Buffer.from('*HQ,12345,V1#'))).toBe(false);
    expect(decoder.canDecode(Buffer.from([0x78, 0x78, 0x05]))).toBe(false);
    expect(decoder.canDecode(Buffer.from('+RESP:GTFRI,'))).toBe(true);
  });
});
