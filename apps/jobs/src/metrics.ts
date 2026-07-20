/**
 * Dependency-free Prometheus metrics for the scheduler process. One-shot job
 * invocations don't fit a scrape model, but the long-lived scheduler does, so
 * it records each run's outcome and exposes them at /metrics.
 *
 * Series:
 *   job_runs_total{job,status}            counter   (status = ok|failed)
 *   job_run_duration_seconds_{sum,count}{job}       summary
 *   job_last_success_timestamp_seconds{job}  gauge  (unix seconds)
 */

const startTime = Date.now();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const durSum = new Map<string, number>();
const durCount = new Map<string, number>();

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Record a finished job run. */
export function recordJobRun(job: string, status: 'ok' | 'failed', durationMs: number): void {
  counters.set(`${job}|${status}`, (counters.get(`${job}|${status}`) ?? 0) + 1);
  durSum.set(job, (durSum.get(job) ?? 0) + durationMs / 1000);
  durCount.set(job, (durCount.get(job) ?? 0) + 1);
  if (status === 'ok') gauges.set(job, Date.now() / 1000);
}

export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  durSum.clear();
  durCount.clear();
}

export function renderMetrics(): string {
  const lines: string[] = [
    '# HELP trackflow_jobs_uptime_seconds Scheduler process uptime in seconds.',
    '# TYPE trackflow_jobs_uptime_seconds gauge',
    `trackflow_jobs_uptime_seconds ${((Date.now() - startTime) / 1000).toFixed(3)}`,
    '# HELP job_runs_total Job runs by job and status.',
    '# TYPE job_runs_total counter',
  ];
  for (const [key, value] of counters) {
    const [job, status] = key.split('|');
    lines.push(`job_runs_total{job="${esc(job!)}",status="${esc(status!)}"} ${value}`);
  }
  lines.push('# HELP job_run_duration_seconds Job run wall-clock duration.');
  lines.push('# TYPE job_run_duration_seconds summary');
  for (const [job, sum] of durSum) {
    lines.push(`job_run_duration_seconds_sum{job="${esc(job)}"} ${sum.toFixed(6)}`);
    lines.push(`job_run_duration_seconds_count{job="${esc(job)}"} ${durCount.get(job) ?? 0}`);
  }
  if (gauges.size) {
    lines.push('# HELP job_last_success_timestamp_seconds Unix time of the last successful run.');
    lines.push('# TYPE job_last_success_timestamp_seconds gauge');
    for (const [job, ts] of gauges) lines.push(`job_last_success_timestamp_seconds{job="${esc(job)}"} ${ts.toFixed(0)}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface HttpResult {
  status: number;
  body: string;
  contentType: string;
}

/** Pure handler for the scheduler's HTTP surface. `/health` is open; `/metrics`
 *  is token-gated via METRICS_TOKEN and refused in production without one. */
export function handleHttp(method: string, path: string, authHeader?: string): HttpResult {
  if (method !== 'GET') return { status: 405, body: 'method not allowed\n', contentType: 'text/plain' };
  if (path === '/health') {
    return { status: 200, body: JSON.stringify({ status: 'ok', service: 'trackflow-jobs' }), contentType: 'application/json' };
  }
  if (path === '/metrics') {
    const token = process.env.METRICS_TOKEN;
    if (token) {
      if (authHeader !== `Bearer ${token}`) return { status: 401, body: 'unauthorized\n', contentType: 'text/plain' };
    } else if (process.env.NODE_ENV === 'production') {
      return { status: 403, body: 'METRICS_TOKEN must be set in production\n', contentType: 'text/plain' };
    }
    return { status: 200, body: renderMetrics(), contentType: 'text/plain; version=0.0.4; charset=utf-8' };
  }
  return { status: 404, body: 'not found\n', contentType: 'text/plain' };
}

/** Boots the scheduler's health + metrics HTTP server. */
export async function startMetricsServer(port = Number(process.env.JOBS_HTTP_PORT ?? 9101)): Promise<void> {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const { status, body, contentType } = handleHttp(req.method ?? 'GET', path, req.headers.authorization);
    res.writeHead(status, { 'content-type': contentType });
    res.end(body);
  });
  server.on('error', (err) => console.warn(`[jobs:http] ${err.message}`));
  server.listen(port, () => console.log(`[jobs] health+metrics on http/${port}`));
}
