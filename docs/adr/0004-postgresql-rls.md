# ADR 0004: PostgreSQL RLS tenant isolation

## Context

Location, user, billing, alert, and audit data are tenant-scoped. Application
filters alone are easy to omit in a growing codebase.

## Decision

Enforce tenant isolation with PostgreSQL Row-Level Security, `FORCE ROW LEVEL
SECURITY`, a non-superuser/non-`BYPASSRLS` runtime role, and transaction-local
tenant context. Reserve audited system paths for cross-tenant jobs and ingest.

## Alternatives considered

Application-only predicates are simpler but fragile. Schema-per-tenant and
database-per-tenant strengthen physical separation at much higher migration and
operational cost.

## Consequences

The database provides default-deny isolation; every transaction must set the
right context and privileged paths need stronger review.

## Risks

Owner/superuser connections bypass RLS. Incorrect system-path use can expose
cross-tenant rows. RLS adds planner and test complexity.

## Revisit trigger

Revisit for regulated tenants requiring physical isolation or if measured RLS
overhead cannot meet the service objective.
