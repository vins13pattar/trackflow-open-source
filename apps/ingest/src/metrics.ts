/**
 * Dependency-free Prometheus metrics for the ingest service — the always-on
 * piece that previously had no HTTP/observability surface at all. Counters and
 * gauges only (ingest cares about throughput + connection health, not request
 * latency), rendered in the text exposition format and served at /metrics.
 *
 * Label cardinality is bounded to the fixed protocol set + decoded message
 * kinds, so it can't grow unboundedly from device traffic.
 */
import { env } from './env.js';
import { ingestHealth, ingestReady } from './health.js';

const startTime = Date.now();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
function labelKey(name: string, labels: Record<string, string>): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${esc(v)}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function incCounter(name: string, labels: Record<string, string> = {}, by = 1): void {
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function addGauge(name: string, labels: Record<string, string>, delta: number): void {
  const key = labelKey(name, labels);
  gauges.set(key, (gauges.get(key) ?? 0) + delta);
}

export function setGauge(name: string, labels: Record<string, string>, value: number): void {
  gauges.set(labelKey(name, labels), value);
}

export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
}

// ---- domain helpers (keep call sites readable + labels consistent) ----
export const metrics = {
  message: (protocol: string, kind: string) => incCounter('ingest_messages_total', { protocol, kind }),
  forwarded: (protocol: string) => incCounter('ingest_forwarded_total', { protocol }),
  decodeError: (protocol: string) => incCounter('ingest_decode_errors_total', { protocol }),
  sinkError: (category = 'unknown') => incCounter('ingest_sink_errors_total', { category }),
  sinkAccepted: () => incCounter('ingest_sink_accepted_total'),
  sinkSucceeded: () => incCounter('ingest_sink_succeeded_total'),
  sinkRetry: (category: string) => incCounter('ingest_sink_retries_total', { category }),
  sinkDropped: (reason: string) => incCounter('ingest_sink_dropped_total', { reason }),
  sinkQueueState: (depth: number, inFlight: number, capacity: number) => {
    setGauge('ingest_sink_queue_depth', {}, depth);
    setGauge('ingest_sink_in_flight', {}, inFlight);
    setGauge('ingest_sink_queue_capacity', {}, capacity);
  },
  connectionOpened: (protocol: string) => addGauge('ingest_active_connections', { protocol }, 1),
  connectionClosed: (protocol: string) => addGauge('ingest_active_connections', { protocol }, -1),
  connectionRejected: (reason: string) => incCounter('ingest_connection_rejected_total', { reason }),
  admissionRejected: (reason: string) => incCounter('ingest_admission_rejected_total', { reason }),
};

const COUNTER_HELP: Record<string, string> = {
  ingest_messages_total: 'Decoded protocol messages, by protocol and kind.',
  ingest_forwarded_total: 'Messages forwarded to the API sink, by protocol.',
  ingest_decode_errors_total: 'Decoder errors (malformed frames), by protocol.',
  ingest_sink_errors_total: 'Failed forwards to the API sink.',
  ingest_sink_accepted_total: 'Messages admitted to the bounded sink queue.',
  ingest_sink_succeeded_total: 'Messages successfully delivered to the API sink.',
  ingest_sink_retries_total: 'Retry attempts after transient sink failures.',
  ingest_sink_dropped_total: 'Messages shed before delivery, by overload reason.',
  ingest_connection_rejected_total: 'TCP connections rejected before protocol processing.',
  ingest_admission_rejected_total: 'Decoded device identities rejected before forwarding.',
};

/** Render the registry in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [
    '# HELP trackflow_ingest_uptime_seconds Ingest process uptime in seconds.',
    '# TYPE trackflow_ingest_uptime_seconds gauge',
    `trackflow_ingest_uptime_seconds ${((Date.now() - startTime) / 1000).toFixed(3)}`,
  ];

  // Group counter series by metric name so each gets a single HELP/TYPE block.
  const byName = new Map<string, Array<[string, number]>>();
  for (const [key, value] of counters) {
    const name = key.split('{')[0]!;
    (byName.get(name) ?? byName.set(name, []).get(name)!).push([key, value]);
  }
  for (const [name, series] of byName) {
    lines.push(`# HELP ${name} ${COUNTER_HELP[name] ?? name}`);
    lines.push(`# TYPE ${name} counter`);
    for (const [key, value] of series) lines.push(`${key} ${value}`);
  }

  if (gauges.size) {
    const gaugesByName = new Map<string, Array<[string, number]>>();
    for (const [key, value] of gauges) {
      const name = key.split('{')[0]!;
      (gaugesByName.get(name) ?? gaugesByName.set(name, []).get(name)!).push([key, value]);
    }
    for (const [name, series] of gaugesByName) {
      lines.push(`# HELP ${name} ${name === 'ingest_active_connections' ? 'Currently open device sockets, by protocol.' : name}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [key, value] of series) lines.push(`${key} ${value}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export interface HttpResult {
  status: number;
  body: string;
  contentType: string;
}

/** Pure request handler for the ingest HTTP surface (testable without a port).
 *  `/health` is open; `/metrics` is token-gated when METRICS_TOKEN is set and
 *  refused in production without one (mirrors the API). */
export function handleHttp(method: string, path: string, authHeader?: string): HttpResult {
  if (method !== 'GET') return { status: 405, body: 'method not allowed\n', contentType: 'text/plain' };
  if (path === '/live') {
    return { status: 200, body: JSON.stringify({ status: 'ok', service: 'trackflow-ingest' }), contentType: 'application/json' };
  }
  if (path === '/health' || path === '/ready') {
    const ready = ingestReady();
    return {
      status: ready ? 200 : 503,
      body: JSON.stringify({ status: ready ? 'ok' : 'not_ready', service: 'trackflow-ingest', ...ingestHealth() }),
      contentType: 'application/json',
    };
  }
  if (path === '/metrics') {
    const token = env.metricsToken;
    if (token) {
      if (authHeader !== `Bearer ${token}`) return { status: 401, body: 'unauthorized\n', contentType: 'text/plain' };
    } else if (env.isProduction) {
      return { status: 403, body: 'METRICS_TOKEN must be set in production\n', contentType: 'text/plain' };
    }
    return { status: 200, body: renderMetrics(), contentType: 'text/plain; version=0.0.4; charset=utf-8' };
  }
  return { status: 404, body: 'not found\n', contentType: 'text/plain' };
}
