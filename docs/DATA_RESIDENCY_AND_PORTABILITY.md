# Data residency and infrastructure portability

Decision date: 2026-07-28. This is an engineering risk posture, not legal
advice. Obtain Indian privacy and transport-sector counsel before admitting
real fleet data.

## DPDPA and Singapore

Hosting Indian vehicle and location data in Singapore is not automatically a
violation of the Digital Personal Data Protection Act, 2023. Section 16 allows
the Central Government to restrict transfers to notified countries or
territories, while preserving stricter requirements in other Indian laws. Rule
15 of the Digital Personal Data Protection Rules, 2025 also makes an overseas
transfer subject to requirements the Central Government may specify concerning
access by a foreign state or entities under its control.

The commencement notification dated 14 November 2025 phases the substantive
processing and transfer provisions in 18 months after publication. That lead
time is not a reason to postpone safeguards. Contractual restrictions, state
VLTD/AIS-140 platform requirements, procurement terms, and later government
notifications may require India hosting even where the DPDPA alone does not.

Primary sources:

- [Digital Personal Data Protection Act, 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf)
- [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [DPDPA commencement notification, 14 November 2025](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
- [AIS-140 Amendment 2](https://morth.nic.in/sites/default/files/ASI/14201910518PMAIS-140.pdf)
- [MoRTH model VLTD platform RFP](https://morth.nic.in/sites/default/files/circulars_document/Signed%20Letter%20and%20Model%20RFP%20merged.pdf)

## TrackFlow production boundary

Until a documented exception is approved, real tenant and vehicle data stays
in India:

- ingest, API, jobs, PostgreSQL, Redis, object storage, backups, logs, traces,
  analytics, support exports, and disaster-recovery copies use India regions;
- map/CDN/static web assets may be global only when they contain no tenant,
  identifier, route, coordinate, token, or authenticated response;
- support and provider access is least-privilege, logged, time-bound, and
  reflected in the subprocessor register;
- retention, export, erasure, breach response, restore tests, and key rotation
  are verified with synthetic data before onboarding.

## Portable application contract

TrackFlow depends on capabilities, not provider product names:

| Capability | Portable contract |
|---|---|
| Compute | OCI containers; HTTP for API/jobs; TCP pass-through for ingest |
| Database | PostgreSQL 16 through `DATABASE_URL`; SQL migrations; non-owner runtime role |
| Ephemeral coordination | Redis 7 through `REDIS_URL` (`rediss://` or a private encrypted network) |
| Object storage | S3-compatible endpoint/bucket/credentials |
| Identity and delivery | Standards or narrow adapters: SAML/OIDC, SMTP/provider APIs, signed webhooks |
| Secrets/telemetry | Environment/file-mounted secrets; OpenTelemetry/Prometheus-compatible output |

Fly, Vercel, Neon, Upstash, AWS, GCP, Azure, and Indian cloud vendors are
deployment overlays. Provider-specific configuration must not enter domain or
tenant logic. A production migration requires export/restore and failover
tests, not application rewrites.

The most cost-effective first real-tenant topology is one India region, two
small ingest instances, two small API instances, one singleton/scheduled jobs
runner, managed PostgreSQL, and a small managed Redis. Do not introduce
Kubernetes, multi-region writes, or premium raw-TCP proxying until measured
scale or a customer SLO requires them.
