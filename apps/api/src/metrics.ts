/**
 * Minimal, dependency-free Prometheus metrics for the API — the golden signals
 * (request rate, errors, latency) in the text exposition format, scraped at
 * `GET /metrics`. Deliberately tiny (no prom-client) and in-process; multi-
 * instance aggregation is the scraper's job.
 *
 * Label cardinality is kept bounded on purpose: requests are labelled by method
 * + numeric status only (never the raw path), so a flood of distinct URLs can't
 * blow up the series count.
 */

const startTime = Date.now();

// http_requests_total{method,status}
const requestCounts = new Map<string, number>();
// http_request_duration_seconds histogram, per method.
const DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
interface Histogram {
  buckets: number[]; // cumulative counts aligned to DURATION_BUCKETS
  sum: number;
  count: number;
}
const durations = new Map<string, Histogram>();

function emptyHistogram(): Histogram {
  return { buckets: new Array(DURATION_BUCKETS.length).fill(0), sum: 0, count: 0 };
}

/** Record one finished request. `durationMs` is wall time for the handler. */
export function recordHttp(method: string, status: number, durationMs: number): void {
  const m = method.toUpperCase();
  const key = `${m}|${status}`;
  requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);

  let h = durations.get(m);
  if (!h) {
    h = emptyHistogram();
    durations.set(m, h);
  }
  const seconds = durationMs / 1000;
  h.sum += seconds;
  h.count += 1;
  for (let i = 0; i < DURATION_BUCKETS.length; i++) {
    if (seconds <= DURATION_BUCKETS[i]!) h.buckets[i]! += 1;
  }
}

/** Reset all series — for tests. */
export function resetMetrics(): void {
  requestCounts.clear();
  durations.clear();
}

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Render the registry in Prometheus text exposition format (v0.0.4). */
export function renderMetrics(): string {
  const lines: string[] = [];

  lines.push('# HELP trackflow_process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE trackflow_process_uptime_seconds gauge');
  lines.push(`trackflow_process_uptime_seconds ${((Date.now() - startTime) / 1000).toFixed(3)}`);

  lines.push('# HELP http_requests_total Total HTTP requests handled, by method and status.');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, count] of requestCounts) {
    const [method, status] = key.split('|');
    lines.push(`http_requests_total{method="${esc(method!)}",status="${esc(status!)}"} ${count}`);
  }

  lines.push('# HELP http_request_duration_seconds Request handler latency.');
  lines.push('# TYPE http_request_duration_seconds histogram');
  for (const [method, h] of durations) {
    const labels = `method="${esc(method)}"`;
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      lines.push(`http_request_duration_seconds_bucket{${labels},le="${DURATION_BUCKETS[i]}"} ${h.buckets[i]}`);
    }
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
    lines.push(`http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${h.count}`);
  }

  return `${lines.join('\n')}\n`;
}
