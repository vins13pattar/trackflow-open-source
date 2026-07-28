# ADR 0012: Backup and disaster recovery

## Context

PostgreSQL contains canonical tenant and location data; Redis and generated
reports can be rebuilt to different degrees.

## Decision

Rely on provider PITR for the production target and test logical
`pg_dump`/`pg_restore` into an isolated database. Validate migration ledger,
required tables, forced RLS, partitioning, and a synthetic marker.

## Alternatives considered

Snapshots alone are fast but less portable. Logical backup alone cannot meet a
five-minute production RPO. Multi-region active-active PostgreSQL is beyond the
current cost/complexity envelope.

## Consequences

Schema-level recoverability is executable locally; provider credentials,
encryption keys, DNS, configuration, and regional recovery need separate
runbooks and drills.

## Risks

An untested PITR or missing key/config backup can make valid database bytes
unusable. Redis ephemeral state and in-flight work are excluded.

## Revisit trigger

Revisit after the first provider PITR drill or when contractual RPO/RTO requires
multi-region replication.
