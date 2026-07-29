# ADR 0008: Delivery and idempotency semantics

## Context

TCP, HTTP, databases, jobs, and external providers fail at different moments.
Retries can happen after a successful side effect.

## Decision

Document each path as best effort, at-least-once, or effectively-once. Reuse
stable event identities and database uniqueness for side effects that require
deduplication. Never claim exactly-once.

## Alternatives considered

At-most-once avoids duplicates but loses transient work. Distributed
transactions are unavailable across devices and providers. A universal durable
log is premature for current measured scale.

## Consequences

Callers and operators can reason about retry windows, but every important side
effect needs its own identity and replay test.

## Risks

Weak legacy device identity and provider timeout ambiguity can still create
semantic duplicates.

## Revisit trigger

Adopt a durable event log/outbox when replay volume, audit requirements, or
measured duplicate impact justifies the added infrastructure.
