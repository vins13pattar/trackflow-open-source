# ADR 0001: Hybrid serverless architecture

## Context

TrackFlow combines bursty web/API work, scheduled processing, and long-lived
raw TCP device connections. One runtime shape is inefficient for all three.

## Decision

Deploy the Next.js UI and stateless Hono API independently from always-on TCP
ingest and jobs. PostgreSQL is the system of record; Redis carries ephemeral
coordination.

## Alternatives considered

A single monolith simplified deployment but coupled scaling and failure. Fully
serverless functions cannot own arbitrary long-lived TCP sockets. Kubernetes
offered control at excessive operational cost for the current scale.

## Consequences

Each boundary can scale and deploy separately, but cross-service networking,
identity, observability, and failure semantics become explicit concerns.

## Risks

Provider limits and cross-service latency can dominate; ephemeral coordination
can disagree temporarily with durable state.

## Revisit trigger

Revisit when measured cross-boundary cost/latency exceeds the operational
savings, or one platform can satisfy TCP, job, and HTTP requirements safely.
