# Delivery semantics and idempotency

TrackFlow does not claim exactly-once delivery.

| Path | Actual guarantee | Duplicate/loss boundary | Protection |
|---|---|---|---|
| Device TCP frame to ingest decoder | Best effort | Legacy devices may disconnect before ACK; frames may be replayed | Protocol validation, bounded frame sizes, error categorization |
| Ingest to API sink | At-least-once while the bounded process queue is alive | A timeout after the API commits can be retried; process loss can lose queued messages | Retryable status classification, bounded attempts/backoff, stable position identity |
| Position database write | Effectively-once where stable identity is present | Devices without a stable serial/timestamp tuple can still produce semantic duplicates | Database conflict handling and device/time identity |
| API event bus to SSE | Best effort | In-process subscriber restart or disconnect loses events; clients refetch current state | Heartbeats, cleanup, reconnect and snapshot/refetch |
| Redis-backed coordination | Best effort coordination | Redis outage can delay/lose ephemeral fan-out state | Database remains system of record; degraded mode must be visible |
| Alert/geofence evaluation | At-least-once processing intent | Replayed positions may re-evaluate rules | Persistent alert identity/deduplication must be verified before stronger claim |
| Jobs and reports | At-least-once scheduler intent | Worker restart can rerun a job | Transactional writes and job-specific idempotency; replay tests remain a gate |
| Notification delivery | At-least-once attempt, externally best effort | Provider timeout after acceptance can duplicate delivery | Per-attempt delivery log, retry cap/backoff; provider idempotency keys should be adopted where supported |
| Webhook delivery | At-least-once attempt | Receiver may process a retry twice | Stable event/delivery identity should be sent for consumer deduplication |

## Retry and overload policy

The ingest forwarder has global and per-device capacity limits. It admits work
only while ready, caps concurrent sink calls, applies an absolute attempt
timeout, and retries only transient errors (HTTP 408, 429, 5xx, timeouts and
network failures). Retries use exponential backoff with jitter and do not
consume extra queue capacity. Permanent failures and exhausted retries are
counted and discarded; queue saturation sheds new work predictably instead of
growing memory without limit.

Graceful shutdown stops listener admission, closes active sockets, marks
readiness false, and drains admitted work until the configured deadline.
Forced process or host loss can still lose in-memory work. A durable log/queue
is the revisit point when that loss window becomes commercially unacceptable.

## Evidence and open gates

Automated tests cover bounded admission, per-device fairness, transient retry,
permanent failure, drain timeout, rejected admission after close, malformed
protocol input and fragmented frames. Before claiming duplicate-safe domain
side effects, add deterministic tests for commit-then-timeout, replayed jobs,
replayed alerts and provider-accepted notification timeouts.
