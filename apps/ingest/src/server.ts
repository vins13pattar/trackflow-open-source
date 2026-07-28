import net from 'node:net';
import { SessionContext, defaultRegistry } from '@trackflow/protocols';
import { env } from './env.js';
import { startHttpServer } from './http.js';
import { metrics } from './metrics.js';
import { startMqttSubscriber } from './mqtt.js';
import { installProcessHandlers, reportError, reportIngestError } from './observability.js';
import { createPresenceStore } from './presence.js';
import { getSessionStore } from './session-store.js';
import { drainForwarder, forwardMessage } from './sink.js';

installProcessHandlers();
const registry = defaultRegistry();
const store = getSessionStore();
const presence = createPresenceStore();
const POD_ID = process.env.INGEST_POD_ID ?? env.instanceId;
const MAX_BUFFER = 64 * 1024; // guard against unbounded growth from junk input

const sockets = new Set<net.Socket>();

function startListener(port: number, protocolName: string): net.Server {
  const decoder = registry.get(protocolName);
  if (!decoder) throw new Error(`No decoder registered for ${protocolName}`);

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const ctx = new SessionContext();
    let buffer = Buffer.alloc(0);
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    // Connection key for cross-pod restore. If this peer had a session on
    // any pod recently, the shared store remembers its IMEI; we restore it
    // so the new pod can forward subsequent frames without waiting for the
    // device to re-log-in.
    const connectionKey = `${protocolName}:${peer}`;
    let imeiPersisted = false;
    void store.lookupImei(connectionKey).then((imei) => {
      if (imei && !ctx.imei) {
        ctx.setImei(imei);
        imeiPersisted = true;
        if (env.trafficLog) console.log(`[ingest:${protocolName}] restored imei=${imei} for ${peer}`);
      }
    });
    // The IMEI bound for this socket in the presence registry, so we can refresh
    // on activity and release exactly that binding on close.
    let boundImei: string | null = null;
    metrics.connectionOpened(protocolName);
    if (env.trafficLog) console.log(`[ingest:${protocolName}] connection from ${peer}`);

    // Claim (or refresh) this device's presence on the current instance. Cheap
    // and idempotent, so calling it on every fix just keeps the TTL warm.
    const markPresence = (imei: string) => {
      boundImei = imei;
      void presence.online(imei, env.instanceId).catch((err) => {
        reportIngestError(err as Error, { where: 'presence.online', imei });
      });
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // A decoder crash on a malformed frame must never take down the
      // listener: report it, drop this socket's buffer, keep serving.
      let decoded: ReturnType<typeof decoder.decode>;
      try {
        decoded = decoder.decode(buffer, ctx);
      } catch (err) {
        metrics.decodeError(protocolName);
        reportIngestError(err as Error, { where: `decode:${protocolName}`, peer, bufferLen: buffer.length });
        buffer = Buffer.alloc(0);
        return;
      }
      const { messages, consumed } = decoded;
      buffer = consumed > 0 ? buffer.subarray(consumed) : buffer;
      if (buffer.length > MAX_BUFFER) buffer = Buffer.alloc(0); // drop garbage

      // Persist the IMEI binding the first time we see it so a reconnect on
      // a different pod can pick up where we left off.
      if (ctx.imei && !imeiPersisted) {
        imeiPersisted = true;
        void store.bindImei(connectionKey, ctx.imei).catch(() => {});
        void store.bindRoute(ctx.imei, POD_ID).catch(() => {});
      }

      for (const msg of messages) {
        metrics.message(protocolName, msg.kind);
        if (msg.reply) socket.write(msg.reply);
        const imei = msg.imei ?? ctx.imei;
        // Once we know the device, record it as present on this instance so
        // commands can be routed here and a reconnect elsewhere takes over.
        if (imei) markPresence(imei);
        // Forward anything carrying a position or telemetry attributes.
        if (imei && (msg.position || msg.attributes)) {
          const accepted = forwardMessage({
            imei,
            protocol: decoder.protocol,
            kind: msg.kind,
            position: msg.position,
            attributes: msg.attributes,
            alarmType: msg.alarmType,
          });
          if (accepted) metrics.forwarded(protocolName);
        }
        const pos = msg.position
          ? ` ${msg.position.latitude.toFixed(5)},${msg.position.longitude.toFixed(5)} ${Math.round(msg.position.speedKph)}kph`
          : '';
        if (env.trafficLog) console.log(`[ingest:${protocolName}] ${msg.kind} imei=${imei ?? '?'}${pos}`);
      }
    });

    socket.on('error', (err) => {
      console.warn(`[ingest:${protocolName}] ${peer} error: ${err.message}`);
      reportError(err, { protocol: protocolName, peer });
    });
    socket.on('close', () => {
      sockets.delete(socket);
      metrics.connectionClosed(protocolName);
      if (env.trafficLog) console.log(`[ingest:${protocolName}] ${peer} disconnected`);
      // Release only our own presence binding — if the device already reconnected
      // to another instance, that newer presence must not be evicted. The IMEI
      // session binding is deliberately NOT forgotten: it stays alive briefly so
      // a fast reconnect (NAT churn, mobile network blips) restores the IMEI;
      // the TTL in the store reaps it after a few hours.
      if (boundImei) {
        void presence.offline(boundImei, env.instanceId).catch(() => {});
      }
    });
  });

  server.on('error', (err) => reportIngestError(err, { where: `listener:${protocolName}`, port }));
  server.listen(port, () => console.log(`[ingest] ${protocolName} listening on tcp/${port}`));
  return server;
}

const tcpServers = [
  startListener(env.gt06Port, 'gt06'),
  startListener(env.h02Port, 'h02'),
  startListener(env.teltonikaPort, 'teltonika'),
  startListener(env.nmeaPort, 'nmea'),
  startListener(env.queclinkPort, 'queclink'),
  startListener(env.meitrackPort, 'meitrack'),
];
void startMqttSubscriber();
const httpServer = startHttpServer();
console.log(`[ingest] pod ${POD_ID} forwarding positions to`, env.sinkUrl);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ingest] ${signal}: stopping listeners and draining sink queue`);
  for (const server of tcpServers) server.close();
  for (const socket of sockets) socket.end();

  const drained = await drainForwarder(env.shutdownTimeoutMs);
  if (!drained) {
    console.warn(`[ingest] drain timed out after ${env.shutdownTimeoutMs}ms; closing ${sockets.size} socket(s)`);
    for (const socket of sockets) socket.destroy();
  }
  httpServer.close(() => process.exit(drained ? 0 : 1));
  setTimeout(() => process.exit(1), 1_000).unref();
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
