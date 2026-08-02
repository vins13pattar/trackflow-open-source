# Validation gap matrix

Status is based on repository, local, and public CI evidence as of 2026-08-02. “Partial”
means useful implementation exists but the requested proof is incomplete.

| Goal | Status | Evidence | Remaining proof |
|---|---|---|---|
| Security workflow | Complete for current repository evidence | PRs #7 and #9 merged; merged-main Security run `30430688995` passed dependency audit, Gitleaks, Semgrep, and SBOM; Dependabot reported zero open alerts | Continue scheduled scans and treat new advisories as release blockers |
| Workload model | Complete | `workload-model.md`; reproducible cost assumptions | Replace planning assumptions with production observations if TrackFlow is operated |
| Device simulator | Complete for requested behaviours | Four protocols, unique IMEIs, fragmentation, invalid/duplicate/out-of-order traffic, clock drift, burst, churn, reconnect and JSON metrics | Validate 10,000-device generator host limits |
| TCP benchmark | Complete at baseline tier | Versioned before/after JSON and generated report for 1,000 sockets | Run on controlled Linux hardware and add a reconnect-storm time series |
| API benchmark | Partial | Authenticated tenant read/write harness publishes p50/p95/p99, throughput, errors, raw samples, cleanup status, and CI regression budgets | Add production-shaped datasets, explicit RLS-overhead comparison, hosted pooler/network, and multi-replica runs |
| PostgreSQL benchmark | Partial | Synthetic two-tenant history harness records RLS/system/noisy-neighbour percentiles, full `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, partition/index/policy/role inventory, retention-function grants, cleanup, and CI budgets | Add production-shaped cardinality, large-partition pruning/retention timing, hosted pooler/IOPS, and replica evidence |
| SSE benchmark | Partial | Redis fan-out, source-echo suppression, tenant filtering, per-client bounded queues, slow-consumer isolation, and real-Redis CI coverage shipped in PR #26 | Publish concurrent-client/reconnect/loss percentiles and hosted multi-replica recovery evidence |
| Domain benchmark | Not complete | Unit coverage for geofence, alerts, reports and notifications | Measure throughput, latency and backlog recovery |
| Backpressure | Partial, ingest slice complete | Bounded per-device/global queue, concurrency, timeout, retry/backoff, shedding and drain tests | Apply explicit budgets to database pools, SSE clients, notifications and reconnect/IP admission |
| High availability | Partial | Health endpoints and graceful ingest shutdown/drain | Exercise 2+ API replicas, multiple ingest instances and at least three infrastructure failure scenarios |
| Delivery/idempotency | Partial | Stable position identity and delivery logs already exist; queue retry tests | Prove API timeout-after-commit, job replay, alert replay and notification replay do not duplicate side effects |
| Database lifecycle | Partial | Time partitioning, future partition job, retention job and restore verifier | Safe large-table migration/backfill, pruning plans, replica suitability and archive/export drill |
| Tenant isolation | Partial | Non-superuser RLS suite covers default deny and basic isolation | Expand REST, GraphQL, joins, reports, alerts, SSE, jobs, admin and manipulated-context cases; benchmark noisy neighbour |
| Protocol security | Partial | Maximum Teltonika length, malformed/truncated tests, categorized errors | Add coverage-guided fuzzing, connection/IP admission controls, replay window and per-device credential migration |
| Observability/SLO | Partial | Prometheus metrics, alert rules, Grafana dashboard, deterministic local endpoints, and CI rule validation | Wire a live backend and demonstrate alert firing/error-budget behaviour |
| Backup/DR | Complete for local logical restore | Synthetic `pg_dump`/`pg_restore` artifact with schema/RLS/partition and marker validation | Provider PITR, regional recovery, DNS/config/key recovery and derived-data rebuild remain unverified |
| Cost/capacity | Complete as estimate | Reproducible JSON and Markdown for 1k/10k/50k | Replace public list-price inputs with bills/contracts and measured utilization |
| ADRs | Complete | Thirteen case-study ADRs | Revisit when scale gates trigger |
| Automated verification | Partial | Unit/integration suites, DB-enabled CI, Security, restore, benchmark regression workflows, and real-Redis realtime/command routing tests | Automated browser journeys, multi-instance recovery, and infrastructure-failure tests remain |
| Browser/product acceptance | Partial | Synthetic local registration, dashboard, device creation, connection guide, desktop layout, and 390 x 844 responsive navigation/device layout are recorded in `docs/LOCAL_ACCEPTANCE.md` | Automate the journey and complete Safari, Firefox, physical mobile, hosted CSP/TLS, and external-provider acceptance |
| Public case study | Partial | Workload, TCP report, cost model, diagrams, decisions, browser-verified screenshots, demo script, and green public workflows | Record and publish the demonstration |

## Priority order

1. Deploy the isolated India synthetic staging slice tracked in issue #10
   without publishing raw tracker ports.
2. Add API/PostgreSQL/SSE benchmark harnesses before making full-platform
   capacity claims.
3. Exercise Redis, PostgreSQL, and process interruption across multiple API
   replicas.
4. Expand RLS verification across every public and background execution path.
5. Run the 10,000-device manual gate on controlled infrastructure.

See [Production readiness](../PRODUCTION_READINESS.md) for the complete tracked
P0/P1/P2 backlog.
