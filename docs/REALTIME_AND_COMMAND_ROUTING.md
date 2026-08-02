# Realtime and device-command routing

This design is infrastructure-agnostic at the application boundary. It needs a
standard Redis 7 endpoint through `REDIS_URL`; it does not call a Fly, Vercel,
Neon, Upstash, AWS, or GCP control-plane API.

## Realtime events

Each API replica owns a local `RealtimeBus` and subscribes once to
`trackflow:realtime:v1`. Position and alert envelopes contain a version,
publisher ID, tenant ID, event kind, and payload. The publishing replica emits
locally and ignores its Redis echo; other replicas validate the envelope and
fan it out only to local listeners for that tenant.

Every SSE connection has an independent 256-event mailbox. The producer never
awaits a slow browser. If that mailbox fills, only that stream is aborted; other
clients and tenants continue. A 25-second heartbeat preserves idle connections.

`apps/api/src/bus.redis.test.ts` runs two independent bus instances through a
real Redis service and proves exactly-once delivery to each replica. Unit tests
cover tenant separation, malformed broker messages, publisher echo suppression,
and slow-consumer isolation.

## Immediate command wake-up

PostgreSQL remains the durable command queue and source of truth:

1. A tenant-authorized API request inserts a `queued` command.
2. The API reads the shared IMEI presence entry.
3. For an admitted GT06 or Teltonika session and the non-destructive
   `request_location` command, the API publishes a wake-up only to
   `trackflow:commands:v1:<holder-instance>`.
4. That ingest instance verifies the version, target instance, IMEI, device ID,
   and command ID, then asks the API to atomically claim supported queued rows.
5. The holder writes the existing GT06 `WHERE#` or Teltonika Codec 12 `getgps`
   frame to the active socket. Concurrent wake-ups serialize per IMEI.

Redis is a latency optimization, not a correctness dependency. On every
admitted connection the ingest service polls the durable queue. A stale presence
entry, missing subscriber, Redis outage, or reconnect race therefore leaves the
row queued for the next holder. Atomic `queued -> sent` claiming prevents two
holders from writing the same command. A late close removes a session only when
it still owns that exact local registration.

Automatic wire delivery is intentionally limited to `request_location` until
physical-device acceptance approves vendor-specific safety behavior. Existing
`immobilize`, `mobilize`, `set_interval`, and `reboot` requests can be recorded
and audited but are not claimed by this automatic socket path. They must not be
enabled for real vehicles without the separate approval and real-device gates
in issues #11 and #12.

## Evidence boundary

Verified locally and in CI:

- real Redis API-to-API fan-out;
- real Redis holder-targeted wake-up delivery;
- per-tenant event isolation and bounded SSE queues;
- poll-on-connect, stale-session replacement, duplicate wake-up serialization,
  supported-protocol wire frames, and unsupported-protocol fallback;
- durable, filtered, atomic command claiming through PostgreSQL.

Not proven by these tests: hosted multi-replica latency, Redis failover under a
managed provider, physical tracker acknowledgements, mobile-network behavior,
or any safety-sensitive real-vehicle command. Those remain external gates.
