# TrackFlow — Deployment Guide

> **Hosting on a specific domain?** See [docs/HOSTING.md](docs/HOSTING.md) for a
> concrete, end-to-end plan (Cloudflare DNS + Fly Mumbai + Vercel + managed
> PostgreSQL/Redis in India, with
> per-service secrets and DNS records). This file is the generic reference.

Deploys the hybrid-serverless stack at low/near-zero idle cost. Only the GPS
**ingest** service is always-on (devices hold open TCP sockets); everything else
scales to ~zero.

## Topology

```
GPS devices ──TCP──▶ apps/ingest (always-on container)
                         │ HTTP (x-ingest-token)
mobile/web  ──HTTPS──▶ apps/api (Hono) ──▶ Postgres 16 (RLS)
                         │                     ▲
                         └── SSE ─▶ dashboard  │ migrations (admin role)
apps/jobs (cron) ─────────────────────────────┘
apps/web (Next.js) ──▶ Vercel / Cloudflare Pages
```

## 1. Accounts (free tiers cover early usage)

| Need | Recommended | Notes |
|---|---|---|
| Postgres | **Any managed PostgreSQL 16** | India region for real vehicle data |
| Ingest host | **Fly.io** (raw TCP, cheap) or AWS Fargate+NLB (India region) | The one always-on piece |
| API host | **Any managed OCI container platform** | Fly.io, Cloud Run, ECS/Fargate, or Azure Container Apps |
| Web | **Vercel** (hobby) or Cloudflare Pages | |
| Object storage | **Any S3-compatible service** | India region for real tenant reports/exports |
| Cache/rate-limit | **Any managed Redis 7** | Standard `REDIS_URL`; optional until multi-instance |
| Edge/DNS/WAF | **Cloudflare** | Free tier |
| Email · SMS · Push · Pay | Resend · MSG91 · Expo/EAS · Razorpay | All key-gated |

> **Data residency (India / DPDP):** TrackFlow's default for real fleet data is
> India-region ingest, API, jobs, PostgreSQL, Redis, object storage, logs, and
> backups. See [the residency and portability decision](docs/DATA_RESIDENCY_AND_PORTABILITY.md).

## 2. Database

The database provider gives an **owner** role (migrations) and you create a **non-superuser
app role** (runtime — superusers bypass RLS).

```bash
export ADMIN_DATABASE_URL="postgres://owner:***@<postgres-host>/trackflow?sslmode=require"
pnpm --filter @trackflow/db db:migrate   # apply committed SQL migrations
pnpm --filter @trackflow/db db:rls        # create trackflow_app role + RLS policies
# Runtime services use:
export DATABASE_URL="postgres://trackflow_app:***@<postgres-host>/trackflow?sslmode=require"
```

Set `APP_DB_PASSWORD` before `db:rls` to control the runtime role's password.

## 3. Environment & secrets

Set per service (see `.env.example`). Secrets go in the host's secret store
(Fly secrets / Vercel env / Workers secrets), never in git.

**API** (`apps/api`)
```
DATABASE_URL=                 # app role
JWT_ACCESS_SECRET=  JWT_REFRESH_SECRET=   # long random
INGEST_SINK_TOKEN=            # shared with ingest
WEB_ORIGIN=https://app.yourdomain.com
RESEND_API_KEY=  EMAIL_FROM=  MSG91_API_KEY=  SMS_SENDER=
RAZORPAY_KEY_ID=  RAZORPAY_KEY_SECRET=  RAZORPAY_WEBHOOK_SECRET=
```
**Ingest** (`apps/ingest`)
```
INGEST_SINK_URL=https://api.yourdomain.com/internal/positions
INGEST_SINK_TOKEN=            # same as API
INGEST_SECURITY_MODE=mtls
INGEST_TLS_CERT_FILE=/run/secrets/ingest-server-cert.pem
INGEST_TLS_KEY_FILE=/run/secrets/ingest-server-key.pem
INGEST_TLS_CA_FILE=/run/secrets/tracker-client-ca.pem
REDIS_URL=rediss://user:password@redis.internal:6379
INGEST_GT06_PORT=5023  INGEST_H02_PORT=5013  INGEST_TELTONIKA_PORT=5027  INGEST_NMEA_PORT=5004
```
**Web** (`apps/web`)
```
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
NEXT_PUBLIC_MAP_STYLE_URL=   # OpenFreeMap/MapTiler style
```

## 4. Deploy each app

- **Ingest** — containerize `apps/ingest` (`tsx src/server.ts`), expose TCP ports
  5023/5013/5027/5004. On Fly: `fly launch` + `fly scale count 1` (min 1). Point
  GPS devices' server IP/port at it.
- **API** — OCI container (`tsx src/server.ts`) on Fly, Cloud Run, ECS/Fargate,
  Azure Container Apps, or another container platform. Front with Cloudflare
  or the chosen provider's managed HTTPS load balancer.
- **Web** — `vercel deploy` (or Cloudflare Pages) with the `NEXT_PUBLIC_*` vars.
- **Jobs** — schedule `pnpm --filter @trackflow/jobs rollup` (e.g. every 15 min)
  and `... report` (weekly) via Fly Machines cron / Cloud Run Jobs / GitHub Actions.
- **Mobile** — `cd apps/mobile && eas build`; set `expo.extra.apiBaseUrl`.

## 5. Domains, webhooks, push

- DNS + TLS via Cloudflare. White-label custom domains use **Cloudflare for SaaS**
  (custom hostnames) → fallback origin = the web app; tenants set a CNAME.
- **Razorpay webhook** → `https://api.yourdomain.com/internal/billing/webhook`
  (set `RAZORPAY_WEBHOOK_SECRET`).
- **Push**: create an EAS project; the app sends its Expo token to `/push/register`.

## 6. Go-live checklist

- [ ] Migrations + RLS applied; app connects as the **non-superuser** role
- [ ] RLS isolation test green (`TF_DB_TESTS=1 pnpm --filter @trackflow/db test`)
- [ ] Rotate all dev secrets; `INGEST_SINK_TOKEN` matches across API/ingest
- [ ] One real device per protocol reports end-to-end (or the simulators)
- [ ] CORS `WEB_ORIGIN` set; HTTPS enforced via Cloudflare
- [ ] Provider backups/PITR on and restore tested; error tracking wired
- [ ] Razorpay live keys + webhook verified; a test upgrade produces a GST invoice
- [ ] Load check: `N=1000 CONCURRENCY=100 node loadtest/run.mjs`

## Cost (≈1,000 devices)
Always-on ingest container ~₹400–800/mo; everything else free-tier → ~₹0 at idle,
~₹1–4k/mo under load — vs the PRD's ~₹26k AWS design.
