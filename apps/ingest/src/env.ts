import type { IngestSecurityMode, TransportSecurityConfig } from './transport-security.js';
import { loadPem } from './transport-security.js';

const isProduction = process.env.NODE_ENV === 'production';
const securityMode = (process.env.INGEST_SECURITY_MODE ?? 'development') as IngestSecurityMode;
if (!['development', 'mtls', 'private_gateway'].includes(securityMode)) {
  throw new Error('INGEST_SECURITY_MODE must be development, mtls, or private_gateway');
}

const sinkUrl = process.env.INGEST_SINK_URL ?? 'http://localhost:8787/internal/positions';
const defaultAdmissionUrl = new URL('/internal/devices/admission', sinkUrl).toString();

export const env = {
  gt06Port: Number(process.env.INGEST_GT06_PORT ?? 5023),
  h02Port: Number(process.env.INGEST_H02_PORT ?? 5013),
  teltonikaPort: Number(process.env.INGEST_TELTONIKA_PORT ?? 5027),
  nmeaPort: Number(process.env.INGEST_NMEA_PORT ?? 5004),
  queclinkPort: Number(process.env.INGEST_QUECLINK_PORT ?? 5073),
  meitrackPort: Number(process.env.INGEST_MEITRACK_PORT ?? 5020),
  sinkUrl,
  admissionUrl: process.env.INGEST_ADMISSION_URL ?? defaultAdmissionUrl,
  sinkToken: process.env.INGEST_SINK_TOKEN ?? 'dev-ingest-token-change-me',
  admissionAllowTtlMs: Number(process.env.INGEST_ADMISSION_ALLOW_TTL_MS ?? 300_000),
  admissionDenyTtlMs: Number(process.env.INGEST_ADMISSION_DENY_TTL_MS ?? 30_000),
  admissionTimeoutMs: Number(process.env.INGEST_ADMISSION_TIMEOUT_MS ?? 2_000),
  sinkQueueCapacity: Number(process.env.INGEST_SINK_QUEUE_CAPACITY ?? 10_000),
  sinkPerDeviceCapacity: Number(process.env.INGEST_SINK_PER_DEVICE_CAPACITY ?? 32),
  sinkConcurrency: Number(process.env.INGEST_SINK_CONCURRENCY ?? 64),
  sinkTimeoutMs: Number(process.env.INGEST_SINK_TIMEOUT_MS ?? 5_000),
  sinkMaxAttempts: Number(process.env.INGEST_SINK_MAX_ATTEMPTS ?? 3),
  sinkRetryBaseMs: Number(process.env.INGEST_SINK_RETRY_BASE_MS ?? 100),
  shutdownTimeoutMs: Number(process.env.INGEST_SHUTDOWN_TIMEOUT_MS ?? 15_000),
  trafficLog: process.env.INGEST_TRAFFIC_LOG ? process.env.INGEST_TRAFFIC_LOG === 'true' : !isProduction,
  transportSecurity: {
    mode: securityMode,
    allowedCidrs: (process.env.INGEST_ALLOWED_CIDRS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    maxConnections: Number(process.env.INGEST_MAX_CONNECTIONS ?? 20_000),
    maxConnectionsPerIp: Number(process.env.INGEST_MAX_CONNECTIONS_PER_IP ?? 1_000),
    idleTimeoutMs: Number(process.env.INGEST_SOCKET_IDLE_TIMEOUT_MS ?? 900_000),
    handshakeTimeoutMs: Number(process.env.INGEST_TLS_HANDSHAKE_TIMEOUT_MS ?? 10_000),
    tlsCertPem: loadPem('INGEST_TLS_CERT_PEM', 'INGEST_TLS_CERT_FILE'),
    tlsKeyPem: loadPem('INGEST_TLS_KEY_PEM', 'INGEST_TLS_KEY_FILE'),
    tlsCaPem: loadPem('INGEST_TLS_CA_PEM', 'INGEST_TLS_CA_FILE'),
  } satisfies TransportSecurityConfig,
  // MQTT — optional; unset = subscriber not started.
  mqttUrl: process.env.INGEST_MQTT_URL,
  mqttTopic: process.env.INGEST_MQTT_TOPIC ?? 'trackflow/+/+/up',
  mqttUsername: process.env.INGEST_MQTT_USERNAME,
  mqttPassword: process.env.INGEST_MQTT_PASSWORD,
  sentryDsn: process.env.SENTRY_DSN,
  // Identity of this ingest instance (for the multi-instance presence registry).
  // Defaults to the hostname, then a random id, so single-instance dev still works.
  instanceId:
    process.env.INGEST_INSTANCE_ID ??
    process.env.FLY_MACHINE_ID ??
    process.env.HOSTNAME ??
    `ingest-${Math.random().toString(16).slice(2, 10)}`,
  // Shared presence store (Upstash Redis REST). Unset = in-memory (single instance).
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL,
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  redisUrl: process.env.REDIS_URL,
  // Health + Prometheus metrics HTTP surface (separate from the TCP listeners).
  httpPort: Number(process.env.INGEST_HTTP_PORT ?? 9100),
  // Read lazily so they can be set per-process (and per-test).
  get metricsToken(): string | undefined {
    return process.env.METRICS_TOKEN;
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
};
