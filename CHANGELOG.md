# Changelog

All notable changes to TrackFlow are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Mixed-protocol synthetic TCP load generator with persistent connections,
  churn, reconnect, malformed/fragmented/duplicate/out-of-order traffic,
  jitter, clock drift, burst traffic, and versioned JSON evidence.
- Bounded ingest-to-API queue with per-device fairness, timeout, retry/backoff,
  overload shedding, health state, metrics, and graceful drain.
- Reproducible TCP benchmark, regression checker, generated report, cost model,
  and synthetic PostgreSQL backup/restore drill.
- Case-study workload model, gap matrix, delivery semantics, demo script, and
  thirteen architecture decision records.
- Webhook destination SSRF guard and tests.

### Changed

- Hardened Teltonika Codec 8/8E parsing for oversized and truncated frames.
- Upgraded/overrode vulnerable Next.js, PostCSS, Sharp, Hono Node server, and
  transitive `shell-quote` versions.
- Webhook signing secrets are now shown only at creation.
- RLS bootstrap DDL validates the application role and escapes the password
  literal.
- CI validates Prometheus rules; dedicated benchmark workflow separates PR,
  nightly 1,000-device, and manual 10,000-device tiers.

### Security

- Local production dependency audit reports zero known vulnerabilities.
- Gitleaks allow-list is restricted to the exact public RFC 6238 test vector.
- Legacy IMEI-only device authentication remains an explicit residual risk.
