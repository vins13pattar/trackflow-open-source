# TrackFlow — Deployment Guide

> **Hosting on a specific domain?** See [docs/HOSTING.md](docs/HOSTING.md) for a
> concrete, end-to-end plan (Cloudflare DNS + Fly Mumbai + Vercel + Neon, with
> per-service secrets and DNS records). This file is the generic reference.

Deploys the hybrid-serverless stack at low/near-zero idle cost. Only the GPS
**ingest** service is always-on (devices hold open TCP sockets); everything else
scales to ~zero.

## Topology

```
GPS devices ──TCP──▶ apps/ingest (always-on container)
                         │ HTTP (x-ingest-token)
mobile/web  ──HTTPS──▶ apps/api (Hono) ──▶ Neon Postgres (RLS)
                         │                     ▲
                         └── SSE ─▶ dashboard  │ migrations (admin role)
apps/jobs (cron) ─────────────────────────────┘
apps/web (Next.js) ──▶ Vercel / Cloudflare Pages
```

## 1. Accounts (free tiers cover early usage)

| Need | Recommended | Notes |
|---|---|---|
| Postgres | **Neon** (serverless) | Scales to zero; HTTP driver for Workers |
| Ingest host | **Fly.io** (raw TCP, cheap) or AWS Fargate+NLB (India region) | The one always-on piece |
| API host | **Fly.io / Cloud Run** container, or Cloudflare Workers (Hono is portable) | |
| Web | **Vercel** (hobby) or Cloudflare Pages | |
| Object storage | **Cloudflare R2** | Reports/exports; zero egress |
| Cache/rate-limit | **Upstash Redis** | Optional until multi-instance |
| Edge/DNS/WAF | **Cloudflare** | Free tier |
| Email · SMS · Push · Pay | Resend · MSG91 · Expo/EAS · Razorpay | All key-gated |

> **Data residency (India / DPDP):** for enterprise deals needing in-country data,
> host ingest + DB in Mumbai (AWS `ap-south-1` Fargate+NLB + RDS/Aurora Serverless,
> or GCP `asia-south1`). The decoupled design makes this a hosting swap.

## 2. Database

Neon gives two roles: an **owner** (migrations) and you create a **non-superuser
app role** (runtime — superusers bypass RLS).

```bash
export ADMIN_DATABASE_URL="postgres://owner:***@<neon-host>/trackflow?sslmode=require"
pnpm --filter @trackflow/db db:migrate   # apply committed SQL migrations
pnpm --filter @trackflow/db db:rls        # create trackflow_app role + RLS policies
# Runtime services use:
export DATABASE_URL="postgres://trackflow_app:***@<neon-host>/trackflow?sslmode=require"
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
- **API** — container (`tsx src/server.ts`) on Fly/Cloud Run, or `wrangler deploy`
  on Workers (Hono is portable; use Neon's HTTP driver there). Front with Cloudflare.
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
- [ ] Backups on (Neon PITR); error tracking (Sentry) wired
- [ ] Razorpay live keys + webhook verified; a test upgrade produces a GST invoice
- [ ] Load check: `N=1000 CONCURRENCY=100 node loadtest/run.mjs`

## Cost (≈1,000 devices)
Always-on ingest container ~₹400–800/mo; everything else free-tier → ~₹0 at idle,
~₹1–4k/mo under load — vs the PRD's ~₹26k AWS design.
