import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleHttp, recordJobRun, renderMetrics, resetMetrics } from './metrics.js';

describe('jobs metrics registry', () => {
  beforeEach(() => resetMetrics());

  it('records runs by job + status, durations, and last-success time', () => {
    recordJobRun('rollup', 'ok', 1200);
    recordJobRun('rollup', 'ok', 800);
    recordJobRun('retention', 'failed', 50);

    const out = renderMetrics();
    expect(out).toContain('job_runs_total{job="rollup",status="ok"} 2');
    expect(out).toContain('job_runs_total{job="retention",status="failed"} 1');
    expect(out).toContain('job_run_duration_seconds_count{job="rollup"} 2');
    expect(out).toContain('job_run_duration_seconds_sum{job="rollup"} 2.000000');
    expect(out).toContain('job_last_success_timestamp_seconds{job="rollup"}');
    // A job that only failed has no last-success gauge.
    expect(out).not.toContain('job_last_success_timestamp_seconds{job="retention"}');
    expect(out).toMatch(/# TYPE job_runs_total counter/);
  });
});

describe('handleHttp', () => {
  const ORIG = process.env.METRICS_TOKEN;
  const ORIG_ENV = process.env.NODE_ENV;
  beforeEach(() => resetMetrics());
  afterEach(() => {
    if (ORIG === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = ORIG;
    process.env.NODE_ENV = ORIG_ENV;
  });

  it('serves /health as JSON ok', () => {
    const r = handleHttp('GET', '/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ status: 'ok', service: 'trackflow-jobs' });
  });

  it('gates /metrics on the bearer token when set', () => {
    process.env.METRICS_TOKEN = 'scrape-secret';
    expect(handleHttp('GET', '/metrics').status).toBe(401);
    expect(handleHttp('GET', '/metrics', 'Bearer scrape-secret').status).toBe(200);
  });

  it('refuses /metrics in production without a token but serves it in dev', () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'production';
    expect(handleHttp('GET', '/metrics').status).toBe(403);
    process.env.NODE_ENV = 'test';
    expect(handleHttp('GET', '/metrics').status).toBe(200);
  });
});
