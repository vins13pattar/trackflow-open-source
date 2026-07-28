/**
 * MQTT ingest. Devices that speak MQTT publish their raw protocol frames to
 * `trackflow/<protocol>/<imei>/up`. The subscriber decodes each payload via the
 * shared decoder registry and forwards it to the API sink. Per-IMEI sessions
 * keep handshake state (so e.g. GT06 IMEI binding still works on subsequent
 * publishes from the same device).
 *
 * Gated on INGEST_MQTT_URL — when unset, `startMqttSubscriber` is a no-op so the
 * ingest service starts cleanly without a broker.
 *
 * The handler is exported separately from the broker bootstrap so unit tests can
 * drive it without a real MQTT client.
 */
import { SessionContext, defaultRegistry } from '@trackflow/protocols';
import type { ProtocolRegistry } from '@trackflow/protocols';
import type mqtt from 'mqtt';
import { env } from './env.js';
import { type MessageForward, forwardMessage } from './sink.js';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h idle session timeout

interface Session {
  ctx: SessionContext;
  lastSeen: number;
}

export interface MqttHandlerDeps {
  registry?: ProtocolRegistry;
  /** Replaceable for tests; defaults to forwardMessage. */
  forward?: (m: MessageForward) => Promise<void | boolean> | void | boolean;
  /** Replaceable for tests; defaults to console.log. */
  log?: (...args: unknown[]) => void;
}

/** Per-IMEI decoder state across publishes. Returned from the factory so tests
 *  can prime sessions and inspect state. */
export function createMqttHandler(deps: MqttHandlerDeps = {}) {
  const registry = deps.registry ?? defaultRegistry();
  const forward = deps.forward ?? forwardMessage;
  const log = deps.log ?? ((..._args: unknown[]) => {});
  const sessions = new Map<string, Session>(); // key: `${protocol}/${imei}`

  /** Topic format: `trackflow/<protocol>/<imei>/<direction>`. Anything else is
   *  ignored. Returns null when the topic isn't ours. */
  function parseTopic(topic: string): { protocol: string; imei: string } | null {
    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'trackflow') return null;
    const protocol = parts[1] ?? '';
    const imei = parts[2] ?? '';
    if (!protocol || !/^\d{6,17}$/.test(imei)) return null;
    return { protocol, imei };
  }

  async function onMessage(topic: string, payload: Buffer): Promise<number> {
    const meta = parseTopic(topic);
    if (!meta) return 0;
    const decoder = registry.get(meta.protocol);
    if (!decoder) {
      log(`[ingest:mqtt] no decoder for protocol ${meta.protocol} (topic=${topic})`);
      return 0;
    }
    const key = `${meta.protocol}/${meta.imei}`;
    const now = Date.now();
    let session = sessions.get(key);
    if (!session || now - session.lastSeen > SESSION_TTL_MS) {
      session = { ctx: new SessionContext(), lastSeen: now };
      sessions.set(key, session);
    }
    session.lastSeen = now;
    // For MQTT the IMEI is authoritative from the topic; bind it up front so
    // protocols that gate on a prior handshake (e.g. Teltonika) accept frames
    // even when the device skips the TCP-only login step.
    if (!session.ctx.imei) session.ctx.setImei(meta.imei);

    const { messages } = decoder.decode(payload, session.ctx);
    let forwarded = 0;
    for (const m of messages) {
      const imei = m.imei ?? session.ctx.imei ?? meta.imei;
      if (!m.position && !m.attributes) continue;
      await forward({
        imei,
        protocol: decoder.protocol,
        kind: m.kind,
        position: m.position,
        attributes: m.attributes,
        alarmType: m.alarmType,
      });
      forwarded += 1;
    }
    return forwarded;
  }

  return { onMessage, sessions, parseTopic };
}

/** Boots the MQTT subscriber when INGEST_MQTT_URL is configured. */
export async function startMqttSubscriber(): Promise<void> {
  if (!env.mqttUrl) {
    console.log('[ingest:mqtt] INGEST_MQTT_URL not set — skipping MQTT subscriber');
    return;
  }
  const { default: mqttLib } = await import('mqtt');
  const handler = createMqttHandler({
    log: (...a) => console.log(...a),
  });
  const topic = env.mqttTopic;
  const client: mqtt.MqttClient = mqttLib.connect(env.mqttUrl, {
    clientId: `trackflow-ingest-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5_000,
    username: env.mqttUsername,
    password: env.mqttPassword,
    clean: true,
  });

  client.on('connect', () => {
    console.log(`[ingest:mqtt] connected to ${env.mqttUrl}; subscribing ${topic}`);
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.warn(`[ingest:mqtt] subscribe failed: ${err.message}`);
    });
  });
  client.on('message', (t, payload) => {
    void handler.onMessage(t, payload).catch((err) => {
      console.warn(`[ingest:mqtt] handler error: ${(err as Error).message}`);
    });
  });
  client.on('error', (err) => console.warn(`[ingest:mqtt] error: ${err.message}`));
  client.on('reconnect', () => console.log('[ingest:mqtt] reconnecting…'));
}
