# ADR 0013: Legacy protocol security

## Context

GT06, H02, Teltonika Codec 8, and NMEA deployments often identify devices with
IMEIs but provide weak or no cryptographic device authentication.

## Decision

Treat raw protocol traffic as untrusted: bound frames and queues, validate
structure/checksums, categorize errors, minimize logs, rate-limit at the network
edge, terminate TLS where devices support it, and publish a migration path to
unique per-device credentials or a trusted gateway.

## Alternatives considered

Rejecting all legacy devices provides stronger identity but breaks the product
constraint. A shared ingest token limits casual abuse but has a large blast
radius. VPN-only access is strong but operationally difficult for field devices.

## Consequences

Parser and overload risk is contained while legacy compatibility remains; IMEI
alone is not proof of device identity.

## Risks

Spoofing, replay, GPS poisoning, brute-force connections, and on-path disclosure
remain possible for incapable hardware.

## Revisit trigger

Require credentials/TLS for any device family that supports them, and revisit
legacy acceptance when abuse is observed or customer/regulatory requirements
demand authenticated telemetry.
