# TrackFlow

[![CI](https://github.com/vins13pattar/trackflow-open-source/actions/workflows/ci.yml/badge.svg)](https://github.com/vins13pattar/trackflow-open-source/actions/workflows/ci.yml)
[![Security](https://github.com/vins13pattar/trackflow-open-source/actions/workflows/security.yml/badge.svg)](https://github.com/vins13pattar/trackflow-open-source/actions/workflows/security.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Hybrid-serverless, low-cost, multi-tenant **GPS tracking SaaS**. Built in-house GPS protocol
decoders (GT06, H02 today) feed a serverless API and a real-time dashboard, on infrastructure that
costs ~₹0 at idle and scales horizontally.

This repository is the public, squashed open-source release. It contains synthetic demo device data
only and does not include production credentials, customer data, or private deployment history.

> **Docs:** [Getting Started](docs/GETTING_STARTED.md) (create a workspace, add devices, geofences,
> alerts, reports, API) · [Architecture](docs/ARCHITECTURE.md) (system, data-flow, tenancy and
> deployment diagrams) · [Deployment](DEPLOY.md) (go live on the low-cost stack) ·
> [Hosting on a domain](docs/HOSTING.md) (concrete Cloudflare + Fly + Vercel + managed
> PostgreSQL plan) · [Production readiness](docs/PRODUCTION_READINESS.md) (current evidence,
> synthetic-only boundary, and tracked P0/P1/P2 gates).

> **Current operating boundary:** the repository and public CI are suitable for
> synthetic development and staging. Do not onboard real tenants, vehicles, or
> locations until every P0 real-data-readiness issue is complete.

## Architecture at a glance

```
GPS device ──TCP──▶ apps/ingest ──HTTP──▶ apps/api ──▶ Postgres (positions, partitioned)
(GT06/H02)          (decoders)            (Hono)        │
                                            └──SSE──▶ apps/web (Next.js + MapLibre live map)
```

| Piece | Tech | Notes |
|---|---|---|
| `apps/ingest` | Node + raw TCP | Custom GT06 (5023), H02 (5013), Teltonika Codec 8 (5027), NMEA (5004) decoders; always-on |
| `apps/api` | Hono (Node now, **Workers-portable**) | Auth, devices, geofences, alerts, analytics, billing, webhooks, branding; `/docs` OpenAPI |
| `apps/web` | Next.js 16, Tailwind, MapLibre, Recharts | Live map, geofences, alerts, reports, settings; light/dark + white-label |
| `apps/mobile` | React Native (Expo) | Phone-as-tracker: sign in, report GPS, push (standalone — see `apps/mobile/README.md`) |
| `apps/jobs` | Node | Trip rollup + scheduled report jobs |
| `packages/protocols` | TypeScript | Decoder framework + GT06/H02/Teltonika/NMEA, encoders, and protocol-vector tests |
| `packages/core` | TypeScript | Geofence + trip-detection engines (pure, tested) |
| `packages/db` | Drizzle + Postgres | Relational, time-partitioned `positions`, **RLS tenant isolation** |
| `packages/notifications` | TypeScript | Email/SMS/webhook/console channel adapters |
| `packages/shared` | jose, zod | JWT, PBKDF2, plans/quotas, schemas — all edge-portable |

## Quickstart (local)

```bash
pnpm install
pnpm db:up                                   # Postgres + Redis via docker compose
pnpm --filter @trackflow/db db:migrate       # apply SQL migrations (uses ADMIN_DATABASE_URL)
pnpm --filter @trackflow/db db:rls           # provision non-superuser role + RLS policies

pnpm api:dev      # API on :8787 (connects as the non-superuser app role)
pnpm ingest:dev   # TCP decoders on :5023 (GT06) and :5013 (H02)
pnpm web:dev      # dashboard on :3000
```

> **Tenant isolation** is enforced by Postgres Row-Level Security. Migrations run as the owner
> (`ADMIN_DATABASE_URL`); the app connects as a **non-superuser** role (`DATABASE_URL`) because
> superusers bypass RLS. Run the RLS isolation test with `TF_DB_TESTS=1 pnpm --filter @trackflow/db test`.

Then register at http://localhost:3000/register, add a device with IMEI `865432019876543`, and feed it
live data with the simulator (no hardware needed):

```bash
pnpm --filter @trackflow/ingest sim gt06 865432019876543   # or: sim h02 / sim teltonika
```

The vehicle appears live on the map and its history replays.

## Tests

```bash
pnpm test                              # all packages
pnpm --filter @trackflow/protocols test  # protocol decoders (CRC, framing, round-trips)
```

The public CI also validates type safety, database migrations and RLS, the production build, a GPS
ingest load-test budget, dependency advisories, Semgrep, Gitleaks, and a CycloneDX SBOM.

## Configuration

Copy `.env.example` to `.env`. Sensible localhost defaults are baked in, so the stack runs without it.

## Contributing and security

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
[SECURITY.md](SECURITY.md) before reporting a vulnerability. Please do not put real IMEIs, customer
locations, credentials, or production database exports in issues, pull requests, or test fixtures.

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
