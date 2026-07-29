# Production device edge and topology

Decision snapshot: 2026-07-28. Development uses synthetic telemetry only.
Real tenant, device, and precise-location data must not be admitted until the
production gates in this document are met.

## Recommendation

Use an **India-first, provider-neutral data plane** for the first production
release:

- two always-on ingest containers in an India region (the Fly reference uses
  Mumbai, `bom`);
- two API containers in the same India region, with at least one kept warm;
- one singleton jobs process in the same region, or scheduled containers with a distributed
  lease so a job cannot execute twice concurrently;
- managed PostgreSQL 16 in India as the durable system of record;
- standard Redis 7 in India for ephemeral rate limits, presence, session
  routing, and multi-replica fan-out (`REDIS_URL`);
- S3-compatible private object storage, logs, backups, error traces, and
  analytics in India whenever they may contain tenant or precise-location data;
- Vercel for the Next.js web application, moving from Hobby to Pro before any
  commercial tenant uses it. Static assets may be globally cached, but
  authenticated API responses and location-bearing logs must not be cached at
  the edge;
- Cloudflare DNS for the web/API names and a DNS-only record to the Fly TCP
  edge.

Singapore hosting is not automatically prohibited by the Digital Personal
Data Protection Act, 2023: section 16 uses a restriction-by-notification model,
and rule 15 of the Digital Personal Data Protection Rules, 2025 makes
cross-border transfers subject to requirements the Central Government may
specify. Other Indian laws, state platform requirements, contracts, and future
notifications can be stricter. Because continuous vehicle locations create
high-impact privacy and operational risk, TrackFlow chooses India-first
residency for real fleets; Singapore remains suitable only for synthetic
development until a documented legal/contract review approves otherwise.
See [DATA_RESIDENCY_AND_PORTABILITY.md](../DATA_RESIDENCY_AND_PORTABILITY.md).

Do not use Kubernetes at this stage. It adds operational cost without solving
the legacy tracker identity problem. Do not buy Cloudflare Spectrum for the
initial release: custom raw TCP requires an Enterprise Spectrum add-on and
Spectrum passes the application payload through rather than upgrading a
plaintext legacy protocol to TLS.

## Device-edge security

IMEI is an identifier, not a credential. A registered IMEI by itself is easy to
copy and cannot prove which physical tracker sent a position.

Use this order of preference:

1. **Device supports client certificates:** require TLS 1.2+ with a unique
   per-device certificate, validate the certificate at the edge, and bind its
   subject to the provisioned IMEI. This is the preferred production profile.
2. **Device supports TLS and an application credential:** issue a unique,
   randomly generated per-device secret and authenticate every connection or
   signed message. Never derive the secret from the IMEI and never share one
   secret across a fleet.
3. **Legacy device cannot do either:** place it behind a carrier private APN or
   customer VPN/gateway with a unique gateway credential. Bind that gateway to
   an explicit tenant, protocol, and list of allowed IMEIs. A fixed carrier
   egress CIDR can be allow-listed as an additional control.

Raw internet-facing IMEI-only access is a development profile and is refused
when `NODE_ENV=production`. Production supports `INGEST_SECURITY_MODE=mtls` or
`private_gateway`. Both call the API admission service before protocol ACK,
state persistence, or forwarding; unknown, inactive, protocol-mismatched, and
certificate-mismatched devices are rejected and admission fails closed.

TLS without client authentication protects confidentiality and server
authenticity, but it does not stop a client from presenting someone else's
IMEI. An IP allow-list is useful only when the carrier or gateway provides
stable egress; mobile SIM addresses behind CGNAT are not a durable device
identity.

The raw TCP edge should have no database or tenant-user credentials. It should
only:

- accept protocol traffic;
- enforce per-source, per-IMEI, per-protocol, and global budgets;
- parse bounded frames in a sandboxed/unprivileged process;
- map an authenticated device or gateway to its allowed IMEI set;
- forward normalized events over an authenticated private/TLS service channel.

Before real data, replace the single shared ingest-to-API bearer token with
short-lived workload identity or mTLS between services. Until that is
implemented, use a high-entropy secret, rotate it, keep it out of logs, and
scope the API endpoint to the ingest network.

## Scale profiles

| Phase | Data | Ingest | API/jobs | Data services | Estimated posture |
|---|---|---|---|---|---|
| Development | Synthetic only | Local process during a test, then stopped | Local/Docker | Local Postgres/Redis | No public tracker ports |
| Hosted staging | Synthetic only | 1 small container | API scales to zero; jobs on demand | Free/PAYG Postgres and Redis; Vercel Hobby | Cheapest integration environment; no HA claim |
| First real tenants | Real | 2 always-on India-region containers | 2 API containers; singleton jobs | India-region managed Postgres/Redis/object storage; Vercel Pro | Cost-effective single-region redundancy |
| Contracted HA | Real | 2+ tested instances and failover | 2+ warm API replicas | Provider plan/SLA selected from measured load | Higher cost, explicit SLO and recovery contract |

The generated workload model is a planning baseline, not a provider quote.
Redis is not the system of record, so start with a small managed standard-Redis
plan and buy HA only when a contracted uptime target or measured outage impact
justifies it. Avoiding a Kubernetes control plane and premium raw-TCP proxy is
the largest early cost saving.

Vercel Hobby is restricted to personal, non-commercial use. Synthetic
development can use it, but production tenants require Vercel Pro or hosting
the web app on Fly. The latter removes a vendor and saves the Pro base fee, but
gives up Vercel's deployment previews and managed Next.js delivery. Keep
Vercel Pro initially unless the extra $20/month is material.

## Required production gates

- Device inventory records the implemented security profile (`mtls` or
  `private_gateway`) and certificate/gateway lifecycle.
- Unknown IMEIs are rejected at the edge rather than accepted and skipped only
  after reaching the API.
- Per-source connection admission, per-IMEI quotas, replay controls, and
  security alerts are implemented and load-tested.
- Two ingest and two API replicas pass connection-drain, instance-loss, Redis
  loss, and database-unavailable exercises.
- Multi-replica SSE uses Redis or another shared bus; the current in-process bus
  is not a production multi-replica design.
- The ingest handoff has a documented data-loss budget. For a stricter RPO than
  the current bounded in-memory queue can provide, add durable buffering before
  production.
- PostgreSQL uses the non-superuser application role with forced RLS; owner
  credentials are migration-only.
- Provider PITR and a restore drill, secret rotation, encryption, retention,
  tenant deletion/export, audit review, and incident response are verified with
  synthetic data before admitting real locations.
- Production logs never contain raw credentials and minimize precise
  coordinates; access to location data is audited and retained only as long as
  the product purpose requires.

## Current provider references

- [Fly.io regions](https://fly.io/docs/reference/regions/)
- [Fly.io resource pricing](https://fly.io/docs/about/pricing/)
- [Fly.io TCP/TLS handlers](https://fly.io/docs/networking/services/)
- [Fly.io connection concurrency controls](https://fly.io/docs/reference/configuration/#services-concurrency)
- [Vercel plans and pricing](https://vercel.com/pricing)
- [Cloudflare Spectrum protocol availability](https://developers.cloudflare.com/spectrum/protocols-per-plan/)
- [Cloudflare Spectrum payload behavior](https://developers.cloudflare.com/spectrum/reference/configuration-options/)
- [NIST IoT device identity and authentication capabilities](https://pages.nist.gov/IoT-Device-Cybersecurity-Requirement-Catalogs/technical/identity/)
- [TLS 1.3 and optional client authentication (RFC 8446)](https://www.rfc-editor.org/info/rfc8446/)
