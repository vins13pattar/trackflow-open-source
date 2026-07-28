# Validation gap matrix

Status is based on repository and local evidence as of 2026-07-28. “Partial”
means useful implementation exists but the requested proof is incomplete.

| Goal | Status | Evidence | Remaining proof |
|---|---|---|---|
| Security workflow | Partial | Local dependency/Gitleaks/Semgrep pass; public scheduled run confirms SAST and SBOM pass and identifies the old-main audit/test-vector failures | Push the remediated branch through an approved PR and require its Security run to pass |
| Workload model | Complete | `workload-model.md`; reproducible cost assumptions | Replace planning assumptions with production observations if TrackFlow is operated |
| Device simulator | Complete for requested behaviours | Four protocols, unique IMEIs, fragmentation, invalid/duplicate/out-of-order traffic, clock drift, burst, churn, reconnect and JSON metrics | Validate 10,000-device generator host limits |
| TCP benchmark | Complete at baseline tier | Versioned before/after JSON and generated report for 1,000 sockets | Run on controlled Linux hardware and add a reconnect-storm time series |
| API benchmark | Not complete | Existing ingest load smoke gate | Add authenticated read/write, tenant/RLS overhead, and multi-replica p50/p95/p99 runs |
| PostgreSQL benchmark | Not complete | Partition/RLS schema and restore verification exist | Generate history, publish `EXPLAIN (ANALYZE, BUFFERS)`, noisy-neighbour and retention results |
| SSE benchmark | Not complete | SSE route and bus exist | Exercise concurrent clients, slow consumers, cleanup, Redis/multi-replica fan-out and event loss |
| Domain benchmark | Not complete | Unit coverage for geofence, alerts, reports and notifications | Measure throughput, latency and backlog recovery |
| Backpressure | Partial, ingest slice complete | Bounded per-device/global queue, concurrency, timeout, retry/backoff, shedding and drain tests | Apply explicit budgets to database pools, SSE clients, notifications and reconnect/IP admission |
| High availability | Partial | Health endpoints and graceful ingest shutdown/drain | Exercise 2+ API replicas, multiple ingest instances and at least three infrastructure failure scenarios |
| Delivery/idempotency | Partial | Stable position identity and delivery logs already exist; queue retry tests | Prove API timeout-after-commit, job replay, alert replay and notification replay do not duplicate side effects |
| Database lifecycle | Partial | Time partitioning, future partition job, retention job and restore verifier | Safe large-table migration/backfill, pruning plans, replica suitability and archive/export drill |
| Tenant isolation | Partial | Non-superuser RLS suite covers default deny and basic isolation | Expand REST, GraphQL, joins, reports, alerts, SSE, jobs, admin and manipulated-context cases; benchmark noisy neighbour |
| Protocol security | Partial | Maximum Teltonika length, malformed/truncated tests, categorized errors | Add coverage-guided fuzzing, connection/IP admission controls, replay window and per-device credential migration |
| Observability/SLO | Partial | Prometheus metrics, alert rules, Grafana dashboard, deterministic local endpoints | Automate Prometheus rule validation and demonstrate alert firing/error-budget behaviour |
| Backup/DR | Complete for local logical restore | Synthetic `pg_dump`/`pg_restore` artifact with schema/RLS/partition and marker validation | Provider PITR, regional recovery, DNS/config/key recovery and derived-data rebuild remain unverified |
| Cost/capacity | Complete as estimate | Reproducible JSON and Markdown for 1k/10k/50k | Replace public list-price inputs with bills/contracts and measured utilization |
| ADRs | Complete | Thirteen case-study ADRs | Revisit when scale gates trigger |
| Automated verification | Partial | Unit/integration suites, DB-enabled CI, security jobs, restore workflow | Add scheduled benchmark workflow and regression budgets; multi-instance/failure tests remain |
| Public case study | Partial | Workload, TCP report, cost model, diagrams, decisions, browser-verified screenshots and demo script | Recorded video and a remote green workflow require user-approved publication |

## Priority order

1. Publish the security/dependency fix through an approved PR and observe the
   public workflow.
2. Add API/PostgreSQL/SSE benchmark harnesses before making full-platform
   capacity claims.
3. Exercise Redis, PostgreSQL, and process interruption across multiple API
   replicas.
4. Expand RLS verification across every public and background execution path.
5. Run the 10,000-device manual gate on controlled infrastructure.
