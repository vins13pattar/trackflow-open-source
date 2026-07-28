# ADR 0006: SSE over WebSockets

## Context

Dashboards primarily receive one-way position and alert updates. Browsers need
reconnection and proxy-friendly streaming; device commands use a different
path.

## Decision

Use Server-Sent Events for authenticated server-to-client delivery, with
heartbeats, disconnect cleanup, and snapshot/refetch after reconnect.

## Alternatives considered

WebSockets support bidirectional traffic but add connection, protocol, and
infrastructure complexity. Polling is resilient but increases latency and
request volume.

## Consequences

The browser path stays simple, but EventSource authentication constraints and
best-effort replay must be handled explicitly.

## Risks

Slow consumers, per-browser connection limits, query-string credentials, and
in-process fan-out can create security or multi-replica gaps.

## Revisit trigger

Adopt WebSockets or a replayable stream when bidirectional features or measured
loss/scale limits exceed SSE's simplicity benefit.
