# ADR 0002: Always-on TCP ingest boundary

## Context

Legacy GPS trackers maintain stateful TCP sessions, fragment frames, reconnect,
and require protocol-specific acknowledgements.

## Decision

Run a dedicated always-on Node.js ingest service with connection-local decoder
state, protocol detection, bounded forwarding, health endpoints, and graceful
drain.

## Alternatives considered

HTTP-only device integration excludes existing hardware. A serverless function
cannot retain socket state. Broker-first TCP gateways reduce custom code but
still require protocol termination and acknowledged handoff.

## Consequences

Protocol parsing is isolated from the API, while deployments must account for
socket drain and reconnect storms.

## Risks

Process loss discards connection-local and queued state; malicious connections
can consume file descriptors or parser CPU.

## Revisit trigger

Introduce connection-aware sharding or a managed gateway when a single-region
ingest pool approaches measured socket, CPU, or reconnect limits.
