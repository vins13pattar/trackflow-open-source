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
