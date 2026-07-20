import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { recordHttp, renderMetrics, resetMetrics } from './metrics.js';

describe('metrics registry', () => {
  beforeEach(() => resetMetrics());

  it('counts requests by method + status and exposes a duration histogram', () => {
    recordHttp('GET', 200, 30);
    recordHttp('GET', 200, 120);
    recordHttp('POST', 500, 5);

    const out = renderMetrics();
    expect(out).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(out).toContain('http_requests_total{method="POST",status="500"} 1');
    // 30ms and 120ms both <= 0.25s bucket → cumulative 2 for GET.
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",le="0.25"} 2');
    // 30ms <= 0.05s but 120ms is not → cumulative 1.
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",le="0.05"} 1');
    expect(out).toContain('http_request_duration_seconds_count{method="GET"} 2');
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",le="+Inf"} 2');
    expect(out).toContain('trackflow_process_uptime_seconds');
  });

  it('emits valid HELP/TYPE headers', () => {
    recordHttp('GET', 200, 10);
    const out = renderMetrics();
    expect(out).toMatch(/# TYPE http_requests_total counter/);
    expect(out).toMatch(/# TYPE http_request_duration_seconds histogram/);
  });
});

describe('GET /metrics endpoint', () => {
  const ORIG = process.env.METRICS_TOKEN;
  const ORIG_ENV = process.env.NODE_ENV;
  beforeEach(() => resetMetrics());
  afterEach(() => {
    if (ORIG === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = ORIG;
    process.env.NODE_ENV = ORIG_ENV;
  });

  it('serves Prometheus text and reflects traffic (no token in dev)', async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'test';
    const app = createApp();
    await app.request('/health'); // not counted
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    // The /health request is excluded; the first /metrics scrape isn't self-counted.
    expect(body).toContain('http_requests_total');
  });

  it('requires the bearer token when METRICS_TOKEN is set', async () => {
    process.env.METRICS_TOKEN = 'scrape-secret';
    const app = createApp();
    expect((await app.request('/metrics')).status).toBe(401);
    const ok = await app.request('/metrics', { headers: { authorization: 'Bearer scrape-secret' } });
    expect(ok.status).toBe(200);
  });

  it('refuses an unauthenticated scrape in production without a token', async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'production';
    const app = createApp();
    expect((await app.request('/metrics')).status).toBe(403);
  });
});
