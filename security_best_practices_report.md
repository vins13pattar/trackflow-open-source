# TrackFlow security best-practices report

Date: 2026-07-28
Scope: TypeScript/JavaScript runtime, Next.js dashboard, Hono API, raw TCP
ingest, PostgreSQL/Drizzle, CI and checked-in operational configuration.

## Executive summary

No critical finding was confirmed in the reviewed source. The previously
failing dependency audit is remediated locally: the production dependency tree
now reports zero known vulnerabilities. This work also fixed tenant-configured
webhook SSRF exposure, stopped recurring disclosure of webhook signing secrets,
hardened Teltonika parsing, bounded ingest forwarding, and constrained RLS
bootstrap SQL. The highest residual design risk is unauthenticated legacy GPS
device identity. The public GitHub Security workflow remains unverified until
these commits are pushed through an approved PR.

## High severity

### SEC-001 — Legacy tracker identity is spoofable

**Impact:** An internet client able to reach a tracker port can claim a known
IMEI and inject plausible location/telemetry for the associated device, harming
location integrity and potentially generating false alerts.

Evidence:

- `apps/ingest/src/server.ts:25-40` accepts TCP sessions and restores/binds IMEI
  state without a per-device cryptographic credential.
- `apps/ingest/src/server.ts:83-100` forwards telemetry based on the decoded
  IMEI.
- `apps/api/src/routes/positions.ts:14-52` trusts the ingest service token and
  performs a cross-tenant IMEI lookup.

Existing controls include protocol checksums/structure checks, a 64 KiB socket
buffer, a bounded downstream queue, API-side schema validation, and a
production startup check that rejects the default ingest token. These controls
protect availability and the internal boundary; they do not authenticate a
legacy device.

Recommended treatment:

1. Put TCP listeners behind network-level connection/IP budgets and security
   event aggregation.
2. Use TLS and unique per-device credentials for capable hardware.
3. For legacy fleets, issue a gateway credential with a small device allow-list
   and rotate it independently from the global ingest token.
4. Add a replay window keyed by device, protocol serial, fix time, and payload
   digest; flag impossible movement and clock changes.
5. Keep IMEI-only devices explicitly classified as lower-assurance telemetry.

## Medium severity

### SEC-002 — SSE access token travels in the URL

`apps/api/src/routes/positions.ts:58-65` accepts the JWT from a `token` query
parameter because browser `EventSource` cannot set an Authorization header.
The structured API logger intentionally records only the pathname
(`apps/api/src/middleware/logger.ts:8-31`), which prevents application-log
leakage, but URLs can still appear in browser history, proxy/access logs,
support captures, and referrers.

Replace the access JWT with a short-lived, single-use stream ticket minted by
an authenticated POST, or use a tightly scoped HttpOnly cookie on a same-origin
stream endpoint. Set `Cache-Control: no-store` and an explicit restrictive
referrer policy. Alert on ticket replay and repeated invalid stream attempts.

### SEC-003 — Live fan-out is process-local and non-replayable

`apps/api/src/bus.ts:3-8` describes the EventEmitter as a development stand-in,
and `apps/api/src/bus.ts:36-54` scopes channels by tenant but cannot cross API
replicas or replay after disconnect. This is primarily an availability and
integrity-of-view risk: clients can miss position/alert events during replica
changes while the database remains canonical.

Implement and test Redis-backed tenant channels before multi-replica claims.
Keep client snapshot/refetch recovery, bound per-tenant SSE connections, measure
slow-consumer behaviour, and document whether the Redis path is pub/sub
(lossy) or a replayable stream.

### SEC-004 — Privileged RLS bypass paths need broader negative tests

`packages/db/src/rls.ts:45-60` installs default-deny `USING` and `WITH CHECK`
policies, while `packages/db/src/rls.ts:104-117` provides tenant and privileged
transaction helpers. `apps/api/src/routes/positions.ts:19-52` legitimately uses
the privileged helper for IMEI-to-tenant resolution. The current integration
suite proves basic reads, cross-tenant writes, and missing-context default deny,
but does not cover every REST/GraphQL/SSE/jobs/admin path.

Expand the non-superuser suite across joins, updates, deletes, reports, alerts,
GraphQL, SSE subscription identity, background jobs and manipulated tenant
context. Treat every new `withSystem` call as a security-review trigger.

## Resolved in this change

### SEC-R01 — Known dependency advisories

The original production audit reported 14 advisories (8 high, 6 moderate),
including vulnerable Next.js, PostCSS, Sharp, Hono Node server, and transitive
`shell-quote`. Direct upgrades and root overrides now select Next.js 16.2.11,
PostCSS 8.5.18, Sharp 0.35.0, `@hono/node-server` 2.0.11, and `shell-quote`
1.9.0. `pnpm audit --prod` reports zero vulnerabilities.

### SEC-R02 — Gitleaks false positive masked the real workflow signal

`.gitleaks.toml` narrowly allow-lists the exact public RFC 6238 test vector only
in `packages/shared/src/totp.test.ts`. It does not disable default rules or
allow broad paths. A redacted full-history-compatible local Gitleaks run passes.

### SEC-R03 — Tenant-configured webhook SSRF

`apps/api/src/webhook-target.ts` now rejects non-HTTP schemes, embedded
credentials, plaintext production targets, local/private/link-local addresses,
and hostnames with any private DNS answer. `apps/api/src/webhook-service.ts`
revalidates before delivery and disables redirect following. A DNS
check-to-connect race remains a residual risk; production should also enforce
egress policy at the network layer.

### SEC-R04 — Repeated webhook secret disclosure

`apps/api/src/routes/webhooks.ts` now returns a signing secret only on creation;
list and update responses omit it. The dashboard presents a copy-once notice.
Encryption at rest and rotation remain desirable follow-up controls.

### SEC-R05 — Malformed Teltonika frame exception

`packages/protocols/src/teltonika/index.ts:16-18,182-223` bounds the advertised
body, accepts only supported codecs/counts, catches truncated record reads, and
validates the trailing record count. The identical 1,000-device workload moved
decoder exceptions from one to zero.

### SEC-R06 — Operator configuration interpolation

`packages/db/src/rls.ts` now constrains the PostgreSQL application role to a
plain identifier and escapes password literals before constructing unavoidable
bootstrap DDL.

## Verification status

- Production pnpm and standalone mobile npm audits: passed with zero known
  vulnerabilities at merge time.
- The redacted full-history Gitleaks scan and Semgrep scan passed.
- PR #7 merged the lockfile and narrowly scoped RFC 6238 test-vector
  remediation; PR #9 merged the standalone mobile advisory remediation.
- Merged-main GitHub Security run `30430688995` passed dependency audit,
  Gitleaks, Semgrep, and CycloneDX SBOM generation.
- Merged-main CI run `30430689023` passed typecheck, migrations/RLS, tests,
  build, Prometheus validation, mobile tests, and the bounded load gate.
- GitHub Dependabot reported zero open alerts after both merges.

This report records repository evidence, not hosted-production accreditation.
The remaining real-data gates are tracked in
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).
