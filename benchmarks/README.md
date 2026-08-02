# TrackFlow benchmark harnesses

All benchmark inputs are synthetic. Raw results use a versioned JSON schema and
are written to `benchmarks/results/`; reports must be generated from those files.

## TCP ingestion

The local harness starts a deterministic HTTP sink, boots all six ingest
listeners, runs the four-protocol simulator, captures client measurements and
the ingest Prometheus snapshot, then sends `SIGTERM` to exercise graceful drain.

```bash
ulimit -n 4096
pnpm benchmark:tcp:local -- --devices=1000 --duration=30 --output=benchmarks/results/tcp-1000-local.json
```

Useful fault controls:

```bash
MOCK_SINK_LATENCY_MS=250 pnpm benchmark:tcp:local -- --devices=1000 --duration=30
MOCK_SINK_FAILURE_RATE=0.25 pnpm benchmark:tcp:local -- --devices=1000 --duration=30
```

Simulator options are `--protocols`, `--devices`, `--duration`,
`--interval`, `--connection-rate`, `--jitter`, `--clock-drift`,
`--burst-size`, `--invalid-rate`, `--fragment-rate`, `--duplicate-rate`,
`--out-of-order-rate`, `--churn-rate`, `--ungraceful-rate`,
`--reconnect-base`, `--reconnect-max`, `--seed`, and `--output`.

The TCP result measures connection establishment, packets, acknowledgements,
generator resource use, and server-side decode/forward/queue counters. It does
not claim database commit or ingest-to-map latency.

## Authenticated API

The authenticated API harness registers an isolated synthetic tenant, creates
one device, warms the request path, measures tenant-scoped device reads and
writes separately, and hard-deletes the tenant in a `finally` cleanup. It emits
p50, p95, p99, throughput, errors, generator limits, and every latency sample as
JSON. Start the local API, PostgreSQL, and Redis first; ingest is not used.

```bash
READ_N=300 WRITE_N=200 CONCURRENCY=20 \
  OUTPUT=benchmarks/results/api-local.json \
  pnpm benchmark:api:local
```

Optional regression controls are `READ_P95_BUDGET_MS`,
`WRITE_P95_BUDGET_MS`, and `MAX_ERROR_RATE`. The CI tier uses bounded synthetic
traffic against one API process and local service containers. It does not claim
hosted, pooler, network, or multi-replica performance.

Recorded local evidence on 2026-08-02 is versioned in
[`results/api-local-2026-08-02.json`](results/api-local-2026-08-02.json). The
generator was Node 24 on a 10-core Apple arm64 host with 24 GiB memory; the API,
PostgreSQL, and Redis all ran locally.

| Operation | Requests | Concurrency | p50 | p95 | p99 | Throughput | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| Authenticated device list | 300 | 20 | 10.1 ms | 20.4 ms | 23.8 ms | 1,760/s | 0 |
| Authenticated device update | 200 | 20 | 14.1 ms | 24.7 ms | 28.7 ms | 1,282/s | 0 |

The harness also verified a `204` hard-delete and a zero-row follow-up for its
synthetic tenant. These values are reproducible development evidence, not a
capacity promise.
