# ADR 0005: Time-partitioned position storage

## Context

Positions are append-heavy, queried mostly by device and time range, and expire
by retention policy. Row-by-row deletion creates vacuum and lock pressure.

## Decision

Partition positions by time, create future partitions ahead of use, retain
tenant/device/time indexes, and remove expired partitions through a guarded
lifecycle job.

## Alternatives considered

A single table is simpler at low volume. TimescaleDB adds useful automation but
provider/extension dependence. Object storage is economical but unsuitable as
the primary interactive query store.

## Consequences

Pruning and retention can remain predictable, at the cost of partition
maintenance and migration discipline.

## Risks

Missing future partitions reject writes; excessive partitions hurt planning;
mis-scoped deletion can destroy more history than intended.

## Revisit trigger

Revisit after published query plans show pruning/index failure or hot storage
crosses the database tier's measured cost/performance boundary.
