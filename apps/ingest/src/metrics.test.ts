import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIngestHealth, updateIngestHealth } from './health.js';
import { handleHttp, metrics, renderMetrics, resetMetrics } from './metrics.js';

describe('ingest metrics registry', () => {
  beforeEach(() => {
    resetMetrics();
    resetIngestHealth();
  });

  it('counts messages/forwards/errors and tracks active connections', () => {
    metrics.connectionOpened('gt06');
    metrics.connectionOpened('gt06');
    metrics.message('gt06', 'location');
    metrics.message('gt06', 'location');
    metrics.message('gt06', 'heartbeat');
    metrics.forwarded('gt06');
    metrics.decodeError('h02');
    metrics.sinkError();
    metrics.sinkAccepted();
    metrics.sinkSucceeded();
    metrics.sinkRetry('timeout');
    metrics.sinkDropped('queue_full');
    metrics.sinkQueueState(7, 3, 100);
    metrics.connectionClosed('gt06');

    const out = renderMetrics();
    expect(out).toContain('ingest_messages_total{kind="location",protocol="gt06"} 2');
    expect(out).toContain('ingest_messages_total{kind="heartbeat",protocol="gt06"} 1');
    expect(out).toContain('ingest_forwarded_total{protocol="gt06"} 1');
    expect(out).toContain('ingest_decode_errors_total{protocol="h02"} 1');
    expect(out).toContain('ingest_sink_errors_total{category="unknown"} 1');
    expect(out).toContain('ingest_sink_accepted_total 1');
    expect(out).toContain('ingest_sink_succeeded_total 1');
    expect(out).toContain('ingest_sink_retries_total{category="timeout"} 1');
    expect(out).toContain('ingest_sink_dropped_total{reason="queue_full"} 1');
    expect(out).toContain('ingest_sink_queue_depth 7');
    expect(out).toContain('ingest_active_connections{protocol="gt06"} 1'); // 2 opened - 1 closed
    expect(out).toContain('trackflow_ingest_uptime_seconds');
    expect(out).toMatch(/# TYPE ingest_messages_total counter/);
  });
});

describe('handleHttp', () => {
  const ORIG = process.env.METRICS_TOKEN;
  const ORIG_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    resetMetrics();
    resetIngestHealth();
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = ORIG;
    process.env.NODE_ENV = ORIG_ENV;
  });

  it('serves /health as JSON ok', () => {
    const r = handleHttp('GET', '/health');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ status: 'ok', service: 'trackflow-ingest' });
  });

  it('separates liveness from readiness while overloaded or draining', () => {
    updateIngestHealth({ accepting: false, queueDepth: 4, queueCapacity: 4, inFlight: 2 });
    expect(handleHttp('GET', '/live').status).toBe(200);
    const ready = handleHttp('GET', '/ready');
    expect(ready.status).toBe(503);
    expect(JSON.parse(ready.body)).toMatchObject({ status: 'not_ready', accepting: false, queueDepth: 4 });
  });

  it('serves /metrics open in dev', () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'test';
    const r = handleHttp('GET', '/metrics');
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/plain');
  });

  it('gates /metrics on the bearer token when set', () => {
    process.env.METRICS_TOKEN = 'scrape-secret';
    expect(handleHttp('GET', '/metrics').status).toBe(401);
    expect(handleHttp('GET', '/metrics', 'Bearer scrape-secret').status).toBe(200);
  });

  it('refuses /metrics in production without a token', () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = 'production';
    expect(handleHttp('GET', '/metrics').status).toBe(403);
  });

  it('404s unknown paths and 405s non-GET', () => {
    expect(handleHttp('GET', '/nope').status).toBe(404);
    expect(handleHttp('POST', '/metrics').status).toBe(405);
  });
});
