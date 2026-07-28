import { describe, expect, it } from 'vitest';
import { SessionContext } from '../base/registry.js';
import { NmeaDecoder } from './index.js';
import { encodeNmeaIdentity, encodeNmeaRmc } from './encode.js';

describe('NMEA decoder', () => {
  it('binds a synthetic gateway identity before position sentences', () => {
    const decoder = new NmeaDecoder();
    const ctx = new SessionContext();
    const imei = '123456789012345';
    const result = decoder.decode(
      Buffer.concat([encodeNmeaIdentity(imei), encodeNmeaRmc({ latitude: 12.97, longitude: 77.59 })]),
      ctx,
    );
    expect(ctx.imei).toBe(imei);
    expect(result.messages.map((message) => message.kind)).toEqual(['login', 'location']);
    expect(result.messages[1]!.imei).toBe(imei);
  });

  it('decodes a real $GPRMC sentence', () => {
    const ctx = new SessionContext();
    const line = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A\r\n';
    const { messages } = new NmeaDecoder().decode(Buffer.from(line, 'ascii'), ctx);
    expect(messages).toHaveLength(1);
    const pos = messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(48.1173, 3); // 48 + 07.038/60
    expect(pos.longitude).toBeCloseTo(11.5167, 3); // 11 + 31.000/60
    expect(pos.gpsValid).toBe(true);
    expect(pos.speedKph).toBeCloseTo(22.4 * 1.852, 1);
  });

  it('rejects a sentence with a bad checksum', () => {
    const ctx = new SessionContext();
    const line = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00\r\n';
    expect(new NmeaDecoder().decode(Buffer.from(line, 'ascii'), ctx).messages).toHaveLength(0);
  });

  it('round-trips an encoded RMC sentence', () => {
    const ctx = new SessionContext();
    const time = new Date('2026-05-23T08:15:42.000Z');
    const frame = encodeNmeaRmc({ latitude: 19.076, longitude: 72.8777, speedKph: 50, course: 270, time });
    const pos = new NmeaDecoder().decode(frame, ctx).messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(19.076, 3);
    expect(pos.longitude).toBeCloseTo(72.8777, 3);
    expect(pos.speedKph).toBeCloseTo(50, 0);
    expect(pos.course).toBeCloseTo(270, 0);
    expect(pos.fixTime.toISOString()).toBe('2026-05-23T08:15:42.000Z');
  });

  it('waits for a complete line', () => {
    const ctx = new SessionContext();
    const partial = '$GPRMC,123519,A,4807.038,N,01131.000';
    const result = new NmeaDecoder().decode(Buffer.from(partial, 'ascii'), ctx);
    expect(result.messages).toHaveLength(0);
    expect(result.consumed).toBe(0);
  });
});
