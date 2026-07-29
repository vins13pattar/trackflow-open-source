# Five-minute case-study demo script

## 0:00–0:40 — Frame the problem

“TrackFlow accepts weakly authenticated, stateful GPS protocols and turns them
into tenant-isolated real-time map updates. The engineering question is not
whether the happy path works; it is whether malformed input, slow dependencies,
reconnect storms, and tenant mistakes fail predictably.”

Show `docs/case-study/README.md`, the architecture diagram, and the evidence
classification in `workload-model.md`.

## 0:40–1:30 — Show the hot path and isolation

Open `apps/ingest/src/server.ts`, `apps/ingest/src/forward-queue.ts`,
`apps/api/src/routes/positions.ts`, and `packages/db/src/rls.ts`.

Explain connection-local decoding, bounded forwarding, the shared ingest
credential, IMEI-to-tenant system lookup, stable position write, tenant-scoped
fan-out, and why PostgreSQL RLS is the final default-deny boundary.

## 1:30–2:30 — Reproduce the load slice

Run:

```bash
pnpm benchmark:tcp:local -- --devices=1000 --duration=15 --interval=1000 --connection-rate=500 --seed=42 --output=benchmarks/results/demo-tcp.json
pnpm benchmark:check benchmarks/results/demo-tcp.json 1000
```

Point out that all identities and locations are synthetic and the boundary ends
at a mock HTTP sink. Show active connections, packets/s, p95 connection and ACK
latency, event-loop lag, RSS, categorized errors, and queue drops.

## 2:30–3:20 — Explain the bottleneck and fix

Open `docs/case-study/tcp-1000-report.md`.

“The baseline produced one contained Teltonika `RangeError` under malformed,
fragmented traffic. The parser already validated CRC, but inner record length
was still trusted. I added maximum body length, codec/count checks, guarded
record parsing, and trailing-count validation. The identical after run moved
decoder exceptions from one to zero. I do not present the small throughput or
ACK changes as statistically significant.”

## 3:20–4:05 — Exercise recovery and restore

Run the forward-queue/graceful-shutdown tests and:

```bash
pnpm restore:drill:local
```

Show the direct artifact in `benchmarks/results/restore-local.json`: custom
backup size and duration, restore time, recovered synthetic marker, migration
count, partition relation kind, and forced-RLS table count. State that this is
not provider PITR.

## 4:05–4:40 — Cost and architecture boundaries

Run `pnpm cost:model` and show `docs/case-study/cost-model.md`. Explain the
largest driver and required architecture changes at 1k, 10k and 50k. Emphasize
that the numbers are list-price estimates, not invoices.

## 4:40–5:00 — Close with engineering judgment

Show `gap-matrix.md`.

“The local TCP and restore slices are measured. Full API/Postgres/SSE
percentiles, multi-instance recovery, the expanded RLS matrix, provider PITR,
and the 10,000-device gate remain unverified. Those are release gates, not
claims hidden in architecture prose.”
