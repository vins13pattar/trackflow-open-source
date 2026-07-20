export const env = {
  gt06Port: Number(process.env.INGEST_GT06_PORT ?? 5023),
  h02Port: Number(process.env.INGEST_H02_PORT ?? 5013),
  teltonikaPort: Number(process.env.INGEST_TELTONIKA_PORT ?? 5027),
  nmeaPort: Number(process.env.INGEST_NMEA_PORT ?? 5004),
  queclinkPort: Number(process.env.INGEST_QUECLINK_PORT ?? 5073),
  meitrackPort: Number(process.env.INGEST_MEITRACK_PORT ?? 5020),
  sinkUrl: process.env.INGEST_SINK_URL ?? 'http://localhost:8787/internal/positions',
  sinkToken: process.env.INGEST_SINK_TOKEN ?? 'dev-ingest-token-change-me',
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
