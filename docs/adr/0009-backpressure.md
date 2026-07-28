# ADR 0009: Backpressure strategy

## Context

TCP senders can outpace a slow API/database sink. Unbounded promises or queues
turn a dependency slowdown into process memory exhaustion.

## Decision

Use bounded global and per-device admission, concurrency limits, absolute
timeouts, classified retry, exponential backoff with jitter, and readiness
failure before resource exhaustion. Shed new work with observable reasons.

## Alternatives considered

Unlimited buffering postpones failure unsafely. Blocking socket reads alone
cannot bound already parsed work. A durable broker improves recovery but is a
larger topology change.

## Consequences

Memory is predictable and noisy devices cannot monopolize the queue; overload
can intentionally lose new positions.

## Risks

Poorly tuned limits reduce throughput or create unfair drops. In-memory queues
are lost on forced process termination.

## Revisit trigger

Tune from controlled benchmarks; adopt durable admission when loss during the
configured drain/retry window violates a commercial objective.
