# Architecture decision records

These records describe TrackFlow's case-study architecture. Accepted decisions
are not permanent: every record names the evidence that should trigger review.

| ADR | Decision |
|---|---|
| [0001](0001-hybrid-serverless-architecture.md) | Hybrid web/API/jobs/TCP deployment |
| [0002](0002-always-on-tcp-ingest.md) | Always-on TCP ingestion boundary |
| [0003](0003-hono-api-deployment.md) | Hono API deployment model |
| [0004](0004-postgresql-rls.md) | PostgreSQL RLS for tenant isolation |
| [0005](0005-time-partitioned-positions.md) | Time-partitioned position storage |
| [0006](0006-sse-over-websockets.md) | SSE for server-to-client live updates |
| [0007](0007-redis-coordination.md) | Redis for ephemeral coordination |
| [0008](0008-delivery-idempotency.md) | Explicit non-exactly-once semantics |
| [0009](0009-backpressure.md) | Bounded admission and retry |
| [0010](0010-horizontal-scaling-boundary.md) | Scale stateless and stateful boundaries differently |
| [0011](0011-observability-slos.md) | Local-first metrics and SLO evidence |
| [0012](0012-backup-disaster-recovery.md) | PostgreSQL-led recovery |
| [0013](0013-legacy-protocol-security.md) | Contain legacy GPS protocol risk |
