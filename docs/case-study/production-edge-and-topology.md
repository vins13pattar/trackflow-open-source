# Production device edge and topology

Decision snapshot: 2026-07-28. Development uses synthetic telemetry only.
Real tenant, device, and precise-location data must not be admitted until the
production gates in this document are met.

## Recommendation

Use a **Singapore data plane** for the first production release:

- two always-on Fly.io ingest Machines in `sin`;
- two Fly.io API Machines in `sin`, with at least one kept warm;
- one singleton jobs process in `sin`, or scheduled Machines with a distributed
  lease so a job cannot execute twice concurrently;
- Neon Postgres in AWS Singapore (`ap-southeast-1`) as the durable system of
  record;
- Upstash Redis in AWS Singapore for ephemeral rate limits, presence, session
  routing, and multi-replica fan-out;
- Vercel for the Next.js web application, moving from Hobby to Pro before any
  commercial tenant uses it;
- Cloudflare DNS for the web/API names and a DNS-only record to the Fly TCP
  edge.

Singapore is the cost-conscious common region currently documented by Fly,
Neon, and Upstash. Fly and Upstash also offer Mumbai, but Neon does not
currently document an India region. Splitting ingest/API from the database
adds latency, egress, and more failure modes. If an actual customer contract
requires India-only storage, choose a managed Postgres service with an India
region before onboarding that customer instead of claiming that Neon
Singapore satisfies residency.

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
4. **Temporary internet-facing legacy exception:** expose only the narrow
   gateway listener, not the API or database. Reject unprovisioned IMEIs before
   forwarding, enforce connection/frame/rate budgets, record the source
   network, detect replay and implausible movement, and mark the fleet as
   `legacy_unverified`. Put an expiry and named risk owner on every exception.

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
| Hosted staging | Synthetic only | 1 small Fly Machine | API scales to zero; jobs on demand | Neon Free; Upstash Free/PAYG; Vercel Hobby | Cheapest integration environment; no HA claim |
| First real tenants | Real | 2 always-on Fly Machines | 2 API Machines; singleton jobs | Neon Launch with 7-day restore window; Upstash fixed/PAYG; Vercel Pro | Cost-effective single-region redundancy |
| Contracted HA | Real | 2+ tested Machines and failover | 2+ warm API replicas | Neon plan/SLA selected from measured load; Upstash Prod Pack only if its loss is no longer tolerable | Higher cost, explicit SLO and recovery contract |

The generated workload model estimates about **$92.67/month at 1,000 devices**
for the lean profile and **$292.67/month** when the public $200/month Upstash
Prod Pack is added. Redis is not the system of record in TrackFlow, so the
Prod Pack is poor value for the first tenants if presence and live fan-out can
temporarily rebuild from PostgreSQL. Revisit it when a contracted uptime target
or measured Redis outage impact justifies the extra $200/month.

Vercel Hobby is restricted to personal, non-commercial use. Synthetic
development can use it, but production tenants require Vercel Pro or hosting
the web app on Fly. The latter removes a vendor and saves the Pro base fee, but
gives up Vercel's deployment previews and managed Next.js delivery. Keep
Vercel Pro initially unless the extra $20/month is material.

## Required production gates

- Device inventory records the security profile (`mtls`, `device_secret`,
  `private_gateway`, or time-bounded `legacy_unverified`) and credential
  lifecycle.
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
- [Neon pricing and restore windows](https://neon.com/pricing)
- [Neon regional status endpoints](https://neon.com/docs/introduction/status)
- [Upstash regions and replication](https://upstash.com/docs/common/concepts/global-replication)
- [Upstash Redis pricing and Prod Pack](https://upstash.com/pricing/redis)
- [Vercel plans and pricing](https://vercel.com/pricing)
- [Cloudflare Spectrum protocol availability](https://developers.cloudflare.com/spectrum/protocols-per-plan/)
- [Cloudflare Spectrum payload behavior](https://developers.cloudflare.com/spectrum/reference/configuration-options/)
- [NIST IoT device identity and authentication capabilities](https://pages.nist.gov/IoT-Device-Cybersecurity-Requirement-Catalogs/technical/identity/)
- [TLS 1.3 and optional client authentication (RFC 8446)](https://www.rfc-editor.org/info/rfc8446/)
