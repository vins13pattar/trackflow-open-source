# TrackFlow production readiness

Last reconciled: 2026-07-29.

TrackFlow's code, dependency, secret-scan, SAST, SBOM, database, test, build,
mobile, and baseline load gates are green on `main`. That evidence supports
synthetic development and staging; it does not prove that a hosted deployment
is ready for real tenant, vehicle, or location data.

## Current operating boundary

- Use deterministic synthetic tenants, devices, IMEIs, and locations only.
- Keep real-data infrastructure in India by default, including database,
  Redis, object storage, logs, backups, analytics, and support tooling.
- Do not expose raw tracker ports until every device uses per-device mTLS or an
  approved private authenticated gateway.
- IMEI is inventory metadata, never proof of device identity.
- Keep ingest stopped when a bounded test is not running.
- Do not reuse the legacy Singapore Fly apps or their database for the India
  staging or production environments.

## Verified evidence

- PR [#7](https://github.com/vins13pattar/trackflow-open-source/pull/7)
  merged authenticated ingest, portability, and reproducible case-study work.
- PR [#9](https://github.com/vins13pattar/trackflow-open-source/pull/9)
  cleared the standalone mobile dependency advisory.
- Merged-main
  [Security run 30430688995](https://github.com/vins13pattar/trackflow-open-source/actions/runs/30430688995)
  passed dependency audit, Gitleaks, Semgrep, and SBOM generation.
- Merged-main
  [CI run 30430689023](https://github.com/vins13pattar/trackflow-open-source/actions/runs/30430689023)
  passed typecheck, migrations/RLS, tests, build, Prometheus validation,
  mobile tests, and the bounded load gate.
- GitHub Dependabot reported zero open alerts after those merges.

Performance values in the case study are historical measurements on the named
workloads, not production guarantees.

## Tracked readiness gates

### P0 — required before real data

- [#10 Deploy an isolated India synthetic staging stack](https://github.com/vins13pattar/trackflow-open-source/issues/10)
- [#11 Establish tracker device identity and credential lifecycle](https://github.com/vins13pattar/trackflow-open-source/issues/11)
- [#12 Complete real-device protocol acceptance](https://github.com/vins13pattar/trackflow-open-source/issues/12)
- [#13 Complete DPDP privacy and tenant data-governance readiness](https://github.com/vins13pattar/trackflow-open-source/issues/13)
- [#14 Verify India-region backups, PITR restore, and incident recovery](https://github.com/vins13pattar/trackflow-open-source/issues/14)
- [#15 Wire live observability, alert delivery, and redaction controls](https://github.com/vins13pattar/trackflow-open-source/issues/15)

### P1 — resilience and scale proof

- [#16 Prove multi-replica recovery and durable ingest handoff](https://github.com/vins13pattar/trackflow-open-source/issues/16)
- [#17 Expand tenant-isolation and privileged-path verification](https://github.com/vins13pattar/trackflow-open-source/issues/17)
- [#18 Publish full-platform capacity evidence](https://github.com/vins13pattar/trackflow-open-source/issues/18)
- [#19 Implement shared realtime fan-out and immediate command routing](https://github.com/vins13pattar/trackflow-open-source/issues/19)

### P2 — product acceptance and release

- [#20 Complete browser, mobile, and external-provider acceptance](https://github.com/vins13pattar/trackflow-open-source/issues/20)
- [#21 Publish a tagged release and recorded case-study demonstration](https://github.com/vins13pattar/trackflow-open-source/issues/21)

## Synthetic India staging requirements

The first hosted environment is intentionally a control-plane staging slice:

1. Create new India-region application, PostgreSQL, Redis, storage, logging,
   and backup resources with names distinct from production.
2. Apply migrations and RLS with the owner role, then run the application as
   the non-superuser `trackflow_app` role.
3. Load only deterministic synthetic records.
4. Deploy the API and web application and verify health plus an authenticated
   synthetic browser journey.
5. Leave raw tracker ports unpublished and the ingest service stopped until
   issue #11 provisions device credentials.
6. Record cost, region, resource identifiers, validation evidence, and teardown
   instructions without committing credentials.

The deployment is incomplete until issue #10 records public-route evidence.
The API reference configuration is
[`fly.staging.api.toml`](../fly.staging.api.toml); it scales to zero and defines
no tracker-port service.
