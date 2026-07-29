# ADR 0007: Redis for ephemeral coordination

## Context

Multiple API/jobs instances need low-latency rate-limit, presence, and event
coordination that should not make Redis the durable source of truth.

## Decision

Use Redis for disposable coordination and pub/sub where enabled. Keep canonical
positions, alerts, users, and delivery records in PostgreSQL.

## Alternatives considered

PostgreSQL-only coordination reduces services but can add polling and hot-row
pressure. A durable log improves replay but costs more operationally. In-memory
coordination cannot span replicas.

## Consequences

Common operations remain fast and Redis loss is bounded to ephemeral state, but
degraded behaviour and resynchronization must be explicit.

## Risks

Pub/sub is not durable, rate-limit state can reset, and client retry storms can
amplify an outage.

## Revisit trigger

Introduce a durable event log when event replay becomes an SLO or when measured
Redis outage recovery cannot meet the recovery target.
