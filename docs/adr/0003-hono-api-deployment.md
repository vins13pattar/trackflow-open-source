# ADR 0003: Hono API deployment model

## Context

The API serves REST, GraphQL, internal ingest, webhooks, authentication, and SSE
while sharing TypeScript contracts with the rest of the repository.

## Decision

Use Hono on Node.js as a horizontally replicable API. Keep durable state in
PostgreSQL and use explicit startup, health, authorization, rate-limit, and
observability middleware.

## Alternatives considered

Next.js route handlers would couple UI and API release cadence. A larger
framework adds conventions but more runtime surface. Edge-only execution
conflicts with some database and streaming requirements.

## Consequences

The API remains small and portable, but application conventions and
multi-instance verification are repository responsibilities.

## Risks

In-process event state is not shared across replicas and connection pools can
multiply with replica count.

## Revisit trigger

Revisit when multi-replica benchmarks show coordination or pool pressure that
requires a different runtime or deployment topology.
