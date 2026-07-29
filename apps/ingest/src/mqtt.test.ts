import { encodeQueclinkLocation } from '@trackflow/protocols';
import { describe, expect, it, vi } from 'vitest';
import { createMqttHandler } from './mqtt.js';
import type { MessageForward } from './sink.js';

describe('MQTT ingest handler', () => {
  const IMEI = '135790246811934';
  const TOPIC = `trackflow/queclink/${IMEI}/up`;

  function makeHandler() {
    const calls: MessageForward[] = [];
    const handler = createMqttHandler({
      forward: async (m) => {
        calls.push(m);
      },
      admit: async () => ({ allowed: true, reason: 'allowed' }),
      log: () => {},
    });
    return { handler, calls };
  }

  it('parses our topic format `trackflow/<protocol>/<imei>/<dir>`', () => {
    const { handler } = makeHandler();
    expect(handler.parseTopic(TOPIC)).toEqual({ protocol: 'queclink', imei: IMEI });
    expect(handler.parseTopic('foo/bar/baz/quux')).toBeNull();
    expect(handler.parseTopic('trackflow/queclink/notanimei/up')).toBeNull();
    expect(handler.parseTopic('trackflow/queclink/')).toBeNull();
  });

  it('decodes a Queclink frame from the payload and forwards to the sink', async () => {
    const { handler, calls } = makeHandler();
    const frame = encodeQueclinkLocation({
      imei: IMEI,
      latitude: 12.97,
      longitude: 77.59,
      speedKph: 50,
      time: new Date('2026-05-01T12:00:00Z'),
    });
    const forwarded = await handler.onMessage(TOPIC, frame);
    expect(forwarded).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.protocol).toBe('queclink');
    expect(calls[0]!.imei).toBe(IMEI);
    expect(calls[0]!.position!.latitude).toBeCloseTo(12.97, 4);
    expect(calls[0]!.position!.speedKph).toBe(50);
  });

  it('ignores unknown protocols silently (returns 0 forwards)', async () => {
    const log = vi.fn();
    const handler = createMqttHandler({
      forward: async () => {},
      admit: async () => ({ allowed: true, reason: 'allowed' }),
      log,
    });
    const n = await handler.onMessage(`trackflow/nonsense/${IMEI}/up`, Buffer.from([0]));
    expect(n).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it('binds the IMEI from the topic up front (so handshake-gated decoders work)', async () => {
    const { handler, calls } = makeHandler();
    const frame = encodeQueclinkLocation({ imei: IMEI, latitude: 1, longitude: 2 });
    await handler.onMessage(TOPIC, frame);
    const sess = handler.sessions.get(`queclink/${IMEI}`);
    expect(sess?.ctx.imei).toBe(IMEI);
    expect(calls[0]!.imei).toBe(IMEI);
  });

  it('reuses the same per-IMEI session across successive publishes', async () => {
    const { handler } = makeHandler();
    const a = encodeQueclinkLocation({ imei: IMEI, latitude: 1, longitude: 2, time: new Date('2026-05-01T12:00:00Z') });
    const b = encodeQueclinkLocation({ imei: IMEI, latitude: 3, longitude: 4, time: new Date('2026-05-01T12:01:00Z') });
    await handler.onMessage(TOPIC, a);
    const sessAfterA = handler.sessions.get(`queclink/${IMEI}`);
    await handler.onMessage(TOPIC, b);
    const sessAfterB = handler.sessions.get(`queclink/${IMEI}`);
    expect(sessAfterA).toBe(sessAfterB);
  });

  it('does not forward when a frame has no position or attributes (status-only)', async () => {
    const { handler, calls } = makeHandler();
    // Send a heartbeat-like Queclink frame: GTHBD has no position.
    const ackFrame = Buffer.from(`+ACK:GTHBD,210901,${IMEI},GV300W,20260501120000,0001$`, 'ascii');
    const n = await handler.onMessage(TOPIC, ackFrame);
    expect(n).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('rejects a frame whose embedded IMEI differs from the admitted topic', async () => {
    const { handler, calls } = makeHandler();
    const frame = encodeQueclinkLocation({ imei: IMEI, latitude: 1, longitude: 2 });
    const n = await handler.onMessage('trackflow/queclink/999999999999999/up', frame);
    expect(n).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
