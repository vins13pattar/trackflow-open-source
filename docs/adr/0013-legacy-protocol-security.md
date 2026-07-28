# ADR 0013: Legacy protocol security

## Context

GT06, H02, Teltonika Codec 8, and NMEA deployments often identify devices with
IMEIs but provide weak or no cryptographic device authentication.

## Decision

IMEI is inventory metadata, never proof of possession. Treat raw protocol
traffic as untrusted and assign each device one production security profile:

1. per-device certificate with mutual TLS;
2. TLS plus a unique high-entropy per-device credential;
3. a carrier private APN or authenticated customer gateway whose credential is
   bound to a tenant, protocol, and explicit IMEI set;
4. a time-bounded `legacy_unverified` exception with an owner and expiry.

The edge rejects unprovisioned IMEIs before forwarding, bounds connections,
frames, queues and retries, validates structure/checksums, detects replay and
implausible movement, minimizes logs, and applies per-source/device admission
budgets. TLS without client authentication and a source-IP allow-list are
defence in depth, not substitutes for device identity.

## Alternatives considered

Rejecting all legacy devices provides stronger identity but breaks the product
constraint. A shared ingest token limits casual abuse but has a large blast
radius. Public IMEI-only compatibility is operationally easy but cannot meet a
high-assurance provenance claim. Cloudflare Spectrum protects and proxies
custom TCP only as an Enterprise add-on and cannot upgrade a plaintext
application payload to TLS.

## Consequences

Parser and overload risk is contained while legacy compatibility remains.
Device procurement and onboarding must record supported credentials. Fleets
that cannot authenticate remain visibly lower assurance.

## Risks

Spoofing, replay, GPS poisoning, brute-force connections, and on-path disclosure
remain possible for incapable hardware.

## Revisit trigger

Revisit a legacy exception at its expiry, when abuse is observed, or when a
customer, insurer, or regulator requires authenticated telemetry. Remove the
shared ingest bearer when workload identity/mTLS is available.
