# Hosting TrackFlow on `trackflow.vinodspattar.in`

Concrete go-live plan for the chosen stack: **Cloudflare DNS · Singapore data plane ·
Fly.io (API + ingest + jobs) · Vercel (web) · Neon (Postgres)**. Generic
reference: [DEPLOY.md](../DEPLOY.md). Operations: [RUNBOOKS.md](RUNBOOKS.md) ·
[ops/](../ops/README.md). Security and cost rationale:
[production-edge-and-topology.md](case-study/production-edge-and-topology.md).

## Topology & subdomains

```
                            Cloudflare DNS (vinodspattar.in zone)
   ┌──────────────────────────────┬───────────────────────────┬────────────────────────┐
   ▼                              ▼                           ▼                        ▼
trackflow.vinodspattar.in   api.trackflow.…           gps.trackflow.…          (Neon host)
   Vercel (Next.js)          Fly sin (Hono API)        Fly sin (TCP ingest)      Neon Postgres
   dashboard                 warm + autoscale          always-on, dedicated IP   ap-southeast-1
        │                         │  ▲                        │ HTTP sink            ▲
        └─────── HTTPS ───────────┘  └──────── HTTP (x-ingest-token) ───────────────┘
                                     Fly sin (jobs scheduler, private)──────────────┘
```

| Subdomain | Serves | Host | Cloudflare proxy |
|---|---|---|---|
| `trackflow.vinodspattar.in` | Dashboard (web) | Vercel | DNS-only (Vercel TLS) — or proxied w/ Full(strict) |
| `api.trackflow.vinodspattar.in` | REST/SSE/GraphQL API | Fly `trackflow-api` | **DNS-only** (Fly issues the cert) |
| `gps.trackflow.vinodspattar.in` | GPS device TCP ingest edge | Fly `trackflow-ingest` | **DNS-only A record** (custom raw TCP through Spectrum requires Enterprise) |
| _(none)_ | Jobs scheduler | Fly `trackflow-jobs` | private (6PN) — no public DNS |
| _(Neon-provided)_ | Postgres | Neon | n/a |

## DNS records to add in Cloudflare

| Type | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `trackflow` | `cname.vercel-dns.com` | DNS-only to start |
| CNAME | `api.trackflow` | `trackflow-api.fly.dev` | DNS-only |
| A | `gps.trackflow` | _Fly ingest dedicated IPv4_ (`fly ips list`) | DNS-only (grey cloud) |
| AAAA | `gps.trackflow` | _Fly ingest dedicated IPv6_ (optional) | DNS-only |
| TXT/MX/CNAME | _(Resend provides)_ | DKIM/SPF/return-path for email | DNS-only |

> **Why DNS-only for api/gps:** GPS trackers speak raw TCP on custom ports
> (5023/5013/5027/5004/5073/5020). Custom TCP through Cloudflare Spectrum
> requires an Enterprise add-on and passes the payload through, so it is not
> the cost-effective initial edge and does not add TLS to a plaintext tracker.
> For `api.`, DNS-only lets Fly's
> Let's Encrypt cert issue cleanly. You can move the API behind Cloudflare's
> proxy later with an origin cert + SSL "Full (strict)".

## Deploy steps

### 0. Prerequisites
Accounts: Fly.io, Vercel, Neon, Cloudflare (zone `vinodspattar.in` already here),
Resend. Install `flyctl`, `vercel`, and `neonctl`.

### 1. Database — Neon (Singapore)
Create a Neon project in AWS **ap-southeast-1**. Neon does not currently
document an India region, while Fly and Upstash both support Singapore. Keeping
the API, ingest, jobs, database, and Redis data plane in one common region
avoids unnecessary cross-region latency and egress. Neon gives an owner role; create
the non-superuser app role + RLS (superusers bypass RLS).

**Run it via the one-click workflow (recommended)** — keeps the DB URL out of
your laptop and out of chat. Add repo secrets `ADMIN_DATABASE_URL` (Neon owner)
and `APP_DB_PASSWORD` (and optionally `DATABASE_URL` = the app-role URL to prove
isolation), then run **Actions → "DB migrate + RLS" → Run workflow** (type
`migrate` to confirm). It applies migrations, provisions the `trackflow_app`
role + RLS, verifies coherence, and runs the RLS isolation test.

**Or run it locally:**
```bash
export ADMIN_DATABASE_URL="postgres://owner:***@<neon-host>/trackflow?sslmode=require"
export APP_DB_PASSWORD="$(openssl rand -hex 24)"
pnpm --filter @trackflow/db db:migrate    # apply committed migrations (0000–0026)
pnpm --filter @trackflow/db db:rls         # create trackflow_app role + RLS policies
# Runtime DATABASE_URL (app role — this is what the API/jobs connect as):
#   postgres://trackflow_app:$APP_DB_PASSWORD@<neon-host>/trackflow?sslmode=require
```

> **Critical:** the API/jobs must connect as the **non-superuser `trackflow_app`
> role**, never the Neon owner. Neon's owner bypasses RLS, which would silently
> break tenant isolation. `ADMIN_DATABASE_URL` is for migrations only — don't
> put it on the running services.

### 2. Generate the app secrets (run locally; set into Fly/Vercel, never commit)
```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # INGEST_SINK_TOKEN  (shared by API + ingest)
openssl rand -hex 32   # ADMIN_API_TOKEN    (operator /admin API)
openssl rand -hex 32   # METRICS_TOKEN      (Prometheus scrape, shared by all 3)
```

### 3. API — Fly (`trackflow-api`, region sin)
```bash
fly apps create trackflow-api
fly secrets set -a trackflow-api \
  DATABASE_URL="postgres://trackflow_app:***@<neon-host>/trackflow?sslmode=require" \
  JWT_ACCESS_SECRET=… JWT_REFRESH_SECRET=… INGEST_SINK_TOKEN=… \
  ADMIN_API_TOKEN=… METRICS_TOKEN=… \
  WEB_ORIGIN="https://trackflow.vinodspattar.in" \
  RESEND_API_KEY=… EMAIL_FROM="TrackFlow <noreply@vinodspattar.in>" \
  CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ZONE_ID=…   # for tenant custom domains
fly deploy --config fly.api.toml
fly scale count 2 -a trackflow-api
fly certs add api.trackflow.vinodspattar.in -a trackflow-api   # after the DNS CNAME exists
```
`assertSecureConfig` refuses to boot in production with any dev-default secret,
so all of the above must be real values.

### 4. Ingest — Fly (`trackflow-ingest`, region sin, always-on)
```bash
fly apps create trackflow-ingest
fly ips allocate-v4 -a trackflow-ingest      # raw TCP needs a dedicated IPv4
fly ips list -a trackflow-ingest             # → put this IP in the gps. A record
fly secrets set -a trackflow-ingest \
  INGEST_SINK_URL="https://api.trackflow.vinodspattar.in/internal/positions" \
  INGEST_SINK_TOKEN=…  METRICS_TOKEN=…  SENTRY_DSN=… \
  UPSTASH_REDIS_REST_URL=…  UPSTASH_REDIS_REST_TOKEN=…   # enables multi-instance presence
fly deploy --config fly.ingest.toml
fly scale count 2 -a trackflow-ingest
```
All six protocol ports + the 9100 health/metrics port are wired in
`fly.ingest.toml`. Devices connect to `gps.trackflow.vinodspattar.in:<port>`.
For real fleets, require the per-device or authenticated-gateway security
profiles in the production topology document; IMEI-only access is an explicitly
accepted legacy exception, not proof of device identity.

### 5. Jobs scheduler — Fly (`trackflow-jobs`, region sin)
```bash
fly apps create trackflow-jobs
fly secrets set -a trackflow-jobs \
  DATABASE_URL="…app role…"  METRICS_TOKEN=…  SENTRY_DSN=… \
  RESEND_API_KEY=…  EMAIL_FROM="TrackFlow <noreply@vinodspattar.in>"  REPORT_EMAIL=… \
  S3_ENDPOINT=…  S3_BUCKET=…  S3_ACCESS_KEY_ID=…  S3_SECRET_ACCESS_KEY=…   # R2 report archive (optional)
fly deploy --config fly.jobs.toml
```
(Cost-saving alternative: skip this machine and run each `jobs:*` as a Fly
Machines / GitHub Actions cron instead of the always-on scheduler.)

### 6. Web — Vercel
- Import the repo; set **Root Directory = `apps/web`** (monorepo).
- Environment variables:
  - `NEXT_PUBLIC_API_BASE_URL=https://api.trackflow.vinodspattar.in`
  - `NEXT_PUBLIC_INGEST_HOST=gps.trackflow.vinodspattar.in`
  - `NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty`
  - `NEXT_PUBLIC_SENTRY_DSN=…` (optional)
- Add domain `trackflow.vinodspattar.in` in Vercel → it tells you the CNAME.

### 7. Email — Resend (domain `vinodspattar.in`)
Add the domain in Resend, paste its DKIM/SPF/return-path records into Cloudflare
DNS, verify. Then invites, password resets, verification, and reports send for
real (the API/jobs are already wired to Resend, key-gated).

### 8. Tenant custom domains (white-label) — Cloudflare for SaaS
Already coded (`/branding/custom-domain`). Set `CLOUDFLARE_API_TOKEN` (Custom
Hostnames: Edit) + `CLOUDFLARE_ZONE_ID` on the API, and configure the fallback
origin to the web app. Tenants then CNAME their domain to your hostname.

### 9. Observability
- **Sentry:** set `SENTRY_DSN` (API/ingest/jobs) + `NEXT_PUBLIC_SENTRY_DSN` (web).
- **Prometheus:** scrape `:8787/metrics` (api), `:9100/metrics` (ingest),
  `:9101/metrics` (jobs) over Fly's private 6PN with the `METRICS_TOKEN` bearer;
  load [ops/prometheus/alerts.yml](../ops/prometheus/alerts.yml) and import
  [ops/grafana/trackflow-slo-dashboard.json](../ops/grafana/trackflow-slo-dashboard.json).

## Environment matrix (what goes where)

| Variable | API | Ingest | Jobs | Web (Vercel) |
|---|:--:|:--:|:--:|:--:|
| `DATABASE_URL` (app role) | ✅ | | ✅ | |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✅ | | | |
| `INGEST_SINK_TOKEN` | ✅ | ✅ | | |
| `INGEST_SINK_URL` | | ✅ | | |
| `WEB_ORIGIN` | ✅ | | | |
| `ADMIN_API_TOKEN` | ✅ | | | |
| `METRICS_TOKEN` | ✅ | ✅ | ✅ | |
| `RESEND_API_KEY` / `EMAIL_FROM` | ✅ | | ✅ | |
| `UPSTASH_REDIS_REST_*` | ✅ (rate limit) | ✅ (presence) | | |
| `CLOUDFLARE_API_TOKEN` / `ZONE_ID` | ✅ | | | |
| `S3_*` (R2) | ✅ (invoices) | | ✅ (reports) | |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | ✅ | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_API_BASE_URL` / `_INGEST_HOST` / `_MAP_STYLE_URL` | | | | ✅ |
| Razorpay / Stripe keys | ✅ | | | |

`ADMIN_DATABASE_URL` is only needed to run migrations/RLS (from CI or your
laptop) — it does **not** belong on the running services.

## Cost (≈ idle → ~1,000 devices)
- Synthetic staging can use one small ingest Machine, scale-to-zero API,
  on-demand jobs, Neon/Upstash free tiers, and Vercel Hobby.
- Before commercial use, move to Vercel Pro and the two-ingest/two-API profile.
  The reproducible model estimates **$92.67/month lean at 1,000 devices**.
- Upstash Prod Pack adds **$200/month**. Because Redis is reconstructable
  rather than the system of record, defer it until an SLO or measured outage
  impact justifies **$292.67/month** at the same modeled tier.

## Go-live checklist
- [ ] Neon created in ap-southeast-1; migrations + RLS applied; app connects as `trackflow_app`
- [ ] Every real device has mTLS, a unique device credential, or an approved authenticated-gateway/legacy exception
- [ ] Unknown IMEIs rejected at the edge; connection, replay and plausibility controls load-tested
- [ ] RLS isolation test green (`TF_DB_TESTS=1 pnpm --filter @trackflow/db test`)
- [ ] All dev-default secrets replaced (API boots — `assertSecureConfig` passes)
- [ ] `INGEST_SINK_TOKEN` identical on API + ingest
- [ ] DNS: `trackflow` (Vercel), `api.trackflow` (Fly cert issued), `gps.trackflow` (A → Fly IP)
- [ ] One simulated device per protocol appears live on the map end-to-end
- [ ] `WEB_ORIGIN` set; HTTPS enforced (Fly `force_https` + Vercel)
- [ ] Resend domain verified; an invite email actually arrives
- [ ] Sentry receiving from all three surfaces; Prometheus scraping; alerts loaded
- [ ] Backups on (Neon PITR); restore-drill workflow green
- [ ] (When taking money) Razorpay/Stripe live keys + webhook verified → GST invoice
