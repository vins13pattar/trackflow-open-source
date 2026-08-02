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

## PostgreSQL RLS and query plans

The database harness creates two synthetic tenants and device-history datasets,
measures the indexed history query through the tenant RLS identity and reviewed
system identity, runs concurrent alternating-tenant reads, captures
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, inventories partitions/indexes/RLS
policies/role attributes/retention-function grants, and deletes both fixtures in
`finally`.

```bash
ROWS_PER_TENANT=5000 DB_QUERY_N=100 DB_CONCURRENCY=10 \
  OUTPUT=benchmarks/results/db-local.json \
  pnpm benchmark:db:local
```

`DB_P95_BUDGET_MS` enables the regression gate. This remains a local small-data
measurement; it does not substitute for production-shaped cardinality, a hosted
pooler, replicas, storage IOPS, or retention on large partitions.

The 2026-08-02 local artifact is
[`results/db-local-2026-08-02.json`](results/db-local-2026-08-02.json):

| Operation | Queries | Concurrency | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|
| Tenant RLS history | 100 | 10 | 2.21 ms | 14.94 ms | 15.88 ms | 0 |
| System-role history | 100 | 10 | 1.31 ms | 11.20 ms | 12.70 ms | 0 |
| Alternating two-tenant history | 200 | 10 | 1.61 ms | 2.42 ms | 2.56 ms | 0 |

The tenant `EXPLAIN ANALYZE` pruned to `positions_2026_08`, used its
`device_id, fix_time` index, returned 100 rows in 0.044 ms, hit six shared
buffers with zero reads, and applied the RLS tenant filter. The artifact also
records `FORCE RLS`, role attributes, all partitions, indexes, the policy, and
executable security-definer retention functions. Cleanup left zero fixture
tenants.

## Realtime fan-out and bounded SSE mailboxes

The realtime harness creates two API bus replicas over real local Redis and
attaches synthetic clients to the same production fan-out and bounded-mailbox
classes used by SSE. It measures every event-to-consumer latency, loss,
duplicates, reconnect-to-first-event latency, cross-tenant delivery, slow-client
overflow isolation, and Redis subscription cleanup. Neither the TCP ingest nor a
hosted service is used.

```bash
REALTIME_CLIENTS=50 REALTIME_INITIAL_EVENTS=200 \
  REALTIME_RECONNECT_CLIENTS=10 REALTIME_RECONNECT_CYCLES=3 \
  REALTIME_RECOVERY_EVENTS=10 REALTIME_SLOW_BURST=320 \
  OUTPUT=benchmarks/results/realtime-local.json \
  pnpm benchmark:realtime:local
```

Optional regression controls are `REALTIME_P95_BUDGET_MS` and
`REALTIME_MAX_LOSS`. `REALTIME_SLOW_BURST` must exceed the production mailbox
capacity (256 by default), because the expected result is that only the stalled
client disconnects on event 257 while healthy clients continue without loss.
This is local synthetic Redis evidence, not hosted proxy, browser, Redis
failover, or multi-region evidence.

The 2026-08-02 local artifact is
[`results/realtime-local-2026-08-02.json`](results/realtime-local-2026-08-02.json):

| Measurement | Result |
|---|---:|
| Published events | 553 |
| Healthy client deliveries | 27,620 / 27,620 |
| Delivery p50 / p95 / p99 | 0.179 / 0.384 / 0.834 ms |
| Missing / duplicate deliveries | 0 / 0 |
| Reconnect-to-first-event p95 | 0.274 ms (30 samples) |
| Slow-client overflow | disconnected on event 257 |
| Healthy loss during slow-client pressure | 0 |
| Cross-tenant deliveries | 0 |
| Redis subscribers before / active / after | 0 / 2 / 0 |

The generator used Node 24 on a 10-core Apple arm64 host with 24 GiB memory.
The regression failure path was also exercised with an impossible p95 budget;
it exited non-zero after restoring Redis subscriptions to the baseline.
