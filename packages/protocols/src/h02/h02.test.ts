import { describe, expect, it } from 'vitest';
import { SessionContext } from '../base/registry.js';
import { H02Decoder } from './index.js';
import { encodeH02Location } from './encode.js';

// Documented location sample from the TrackFlow PRD.
const PRD_LOCATION =
  '*HQ,123456789012345,V1,120530,A,2234.5678,N,08812.3456,E,012.5,180,150224,FFFFFBFF#';

describe('H02 decoder', () => {
  it('decodes the PRD location sample', () => {
    const ctx = new SessionContext();
    const { messages } = new H02Decoder().decode(Buffer.from(PRD_LOCATION, 'ascii'), ctx);
    expect(messages).toHaveLength(1);
    const msg = messages[0]!;
    expect(msg.kind).toBe('location');
    expect(msg.imei).toBe('123456789012345');
    const pos = msg.position!;
    expect(pos.latitude).toBeCloseTo(22.5761, 3); // 22 + 34.5678/60
    expect(pos.longitude).toBeCloseTo(88.2058, 3); // 88 + 12.3456/60
    expect(pos.speedKph).toBeCloseTo(23.15, 1); // 12.5 knots
    expect(pos.course).toBe(180);
    expect(pos.gpsValid).toBe(true);
    expect(pos.fixTime.toISOString()).toBe('2024-02-15T12:05:30.000Z');
  });

  it('round-trips a location frame (encode -> decode)', () => {
    const ctx = new SessionContext();
    const time = new Date('2026-05-21T08:15:42Z');
    const frame = encodeH02Location({
      imei: '868120303456789',
      latitude: 19.076,
      longitude: 72.8777,
      speedKph: 60,
      course: 275,
      time,
    });
    const pos = new H02Decoder().decode(frame, ctx).messages[0]!.position!;
    expect(pos.latitude).toBeCloseTo(19.076, 3);
    expect(pos.longitude).toBeCloseTo(72.8777, 3);
    expect(pos.speedKph).toBeCloseTo(60, 0);
    expect(pos.course).toBe(275);
    expect(pos.fixTime.toISOString()).toBe('2026-05-21T08:15:42.000Z');
  });

  it('classifies a heartbeat (NBR)', () => {
    const ctx = new SessionContext();
    const { messages } = new H02Decoder().decode(
      Buffer.from('*HQ,123456789012345,NBR,120545#', 'ascii'),
      ctx,
    );
    expect(messages[0]!.kind).toBe('heartbeat');
    expect(ctx.imei).toBe('123456789012345');
  });

  it('retains a partial frame for the next read', () => {
    const ctx = new SessionContext();
    const partial = '*HQ,123456789012345,V1,120530,A,2234.5678,N,08812.3456';
    const result = new H02Decoder().decode(Buffer.from(partial, 'ascii'), ctx);
    expect(result.messages).toHaveLength(0);
    expect(result.consumed).toBe(0);
  });
});
