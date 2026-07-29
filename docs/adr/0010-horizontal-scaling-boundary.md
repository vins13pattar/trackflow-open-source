# ADR 0010: Horizontal scaling boundary

## Context

HTTP requests are short-lived; TCP sessions hold decoder and acknowledgement
state for the life of a connection.

## Decision

Scale API and jobs as stateless replicas. Scale ingest as a pool of
connection-owning instances behind TCP-aware health/drain, accepting reconnect
rather than live session migration.

## Alternatives considered

Sticky session migration is complex and protocol-specific. A single ingest node
is operationally simple but lacks failure capacity. Shared socket state is not
practical.

## Consequences

API failover is conventional; ingest deployment/failure causes a bounded device
reconnect storm and may lose in-memory work.

## Risks

Load balancers may concentrate long-lived sockets and reconnect storms can
overload all instances simultaneously.

## Revisit trigger

Add connection-aware placement/sharding when measured distribution, file
descriptor, or recovery-time targets fail at the next tier.
