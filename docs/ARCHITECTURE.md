# TrackFlow Architecture

TrackFlow is a hybrid-serverless, multi-tenant GPS-tracking SaaS built as a pnpm + turbo monorepo.
The only always-on piece is the TCP **ingest** service (GPS devices hold sockets open); everything
else scales to ~zero. This document is the visual companion to [README.md](../README.md),
[DEPLOY.md](../DEPLOY.md), and [PROJECT_PLAN.md](PROJECT_PLAN.md).

## System overview

```mermaid
flowchart LR
  subgraph Devices["Data sources"]
    GPS["GPS trackers<br/>GT06 · H02 · Teltonika<br/>NMEA · Queclink · Meitrack"]
    MQTTDEV["MQTT devices"]
    PHONE["apps/mobile<br/>React Native (Expo)<br/>phone-as-tracker"]
  end

  subgraph Ingest["apps/ingest — always-on Node"]
    TCP["TCP listeners<br/>:5023 :5013 :5027<br/>:5004 :5073 :5020"]
    ADMIT["transport identity + device admission<br/>mTLS or private gateway"]
    DEC["packages/protocols<br/>decoders + encoders"]
    SESS["session store<br/>cross-pod IMEI map"]
    PRES["presence registry<br/>imei → instance"]
    IHTTP["HTTP :9100<br/>/health /metrics"]
  end

  subgraph API["apps/api — Hono :8787 (Workers-portable)"]
    SINK["POST /internal/positions<br/>(x-ingest-token)"]
    PSVC["positions-service<br/>recordPosition()"]
    GEO["geofence-service"]
    BUS["in-process bus<br/>pub/sub fan-out"]
    ROUTES["REST + GraphQL + OpenAPI /docs<br/>auth · MFA · SAML/SCIM · devices<br/>groups · vehicles · geofences · alerts<br/>analytics · billing · webhooks · branding<br/>API keys · privacy export/delete · admin"]
    SSE["GET /positions/stream<br/>(SSE)"]
    AMET["/metrics (Prometheus)"]
  end

  subgraph Data["Data & state"]
    PG[("Postgres 16<br/>DATABASE_URL · Drizzle · RLS<br/>time-partitioned positions")]
    REDIS[("Redis 7<br/>REDIS_URL<br/>sessions · presence · rate limits")]
    R2[("S3 / Cloudflare R2<br/>reports · exports")]
  end

  subgraph Jobs["apps/jobs — scheduler (HTTP :9101)"]
    JOBS["trip rollup · daily analytics rollup<br/>retention · subscriptions · notify-retry<br/>weekly CSV+PDF report · ingest-health watchdog"]
  end

  subgraph Web["apps/web — Next.js 16"]
    UI["dashboard · MapLibre live map<br/>geofence drawing · alerts · reports<br/>settings · white-label branding"]
  end

  NOTIF["packages/notifications<br/>email · SMS · WhatsApp<br/>webhook · push · console"]

  GPS -- "raw TCP frames" --> TCP
  MQTTDEV --> Ingest
  TCP --> DEC
  DEC --> ADMIT
  ADMIT -- "admitted fixes (HTTP + token)" --> SINK
  Ingest <--> REDIS
  PHONE -- "HTTPS /devices/:id/report<br/>(offline queue + sync)" --> ROUTES
  SINK --> PSVC
  PSVC --> GEO
  PSVC -- "insert position,<br/>update device" --> PG
  GEO -- "fired alerts" --> NOTIF
  PSVC --> BUS
  BUS --> SSE
  SSE -- "positions + alerts (SSE)" --> UI
  UI -- "REST (JWT / API key)" --> ROUTES
  ROUTES --> PG
  ROUTES -- "presence lookup" --> REDIS
  JOBS --> PG
  JOBS -- "archive CSV/PDF" --> R2
  JOBS --> NOTIF
  NOTIF -- "Resend · MSG91 · Expo push<br/>customer webhooks" --> EXT(("external<br/>providers"))
```

**Shared packages** underpin all apps: `packages/protocols` (decoder framework + 6 protocols +
two-way command encoders), `packages/core` (pure geofence + trip-detection engines),
`packages/db` (Drizzle schema, migrations, RLS), `packages/shared` (JWT, PBKDF2, TOTP/MFA,
zod schemas, plans/quotas, presence store, dependency-free Sentry transport — all edge-portable),
`packages/notifications` (channel adapters), and `packages/storage` (S3/R2 client).

## Position data flow (hot path)

```mermaid
sequenceDiagram
  participant D as GPS device
  participant I as apps/ingest
  participant A as apps/api
  participant P as Postgres (RLS)
  participant W as Dashboard (web)

  D->>I: TCP frame (e.g. GT06 login + location)
  I->>I: decode via packages/protocols<br/>(decoder crash ⇒ contained)
  I->>A: admit IMEI + protocol + transport identity
  A-->>I: allow only active, matching provisioned device
  I-->>D: protocol ACK / reply after admission
  I->>I: bind admitted IMEI in session store + presence registry
  I->>A: POST /internal/positions (x-ingest-token)
  A->>P: recordPosition(): resolve device→tenant,<br/>insert into partitioned positions,<br/>update device last_seen/telemetry
  A->>A: evaluateGeofences() → entry/exit alerts
  A->>A: dispatch alerts (notifications + webhooks)
  A->>A: publishPosition() on in-process bus
  A-->>W: SSE event: position / alert
  W->>W: MapLibre marker moves (clustered ≥1k),<br/>trail playback updates
```

Failures never propagate backwards: a flaky sink doesn't drop the device socket, a decoder
crash on a malformed frame drops that buffer only, and telemetry (Sentry, metrics) never
blocks the pipeline.

## Multi-tenancy & security

```mermaid
flowchart TD
  REQ["Request"] --> AUTHN["Auth: JWT session (+ optional TOTP MFA)<br/>or API key (PBKDF2-hashed)<br/>or SAML SSO / SCIM"]
  AUTHN --> CTX["tenant + role + permissions context"]
  CTX --> RL["rate limit (per key / per tenant)"]
  RL --> TX["withTenant(tx): SET app.tenant_id"]
  TX --> RLS["Postgres Row-Level Security<br/>app role is non-superuser —<br/>every table policy filters by tenant_id"]
  RLS --> DATA[("tenant-scoped rows")]
```

- Migrations run as the DB **owner** (`ADMIN_DATABASE_URL`). Tenant queries use
  the `NOSUPERUSER NOBYPASSRLS` identity (`DATABASE_URL`); enumerated
  cross-tenant paths use a separate `SYSTEM_DATABASE_URL` identity and are
  reviewed in `docs/SYSTEM_ACCESS_INVENTORY.md`.
- Audit log, quotas and plan limits are enforced per tenant; privacy routes provide
  DPDP/GDPR export and workspace hard-delete.

## Deployment topology (low-cost stack)

```mermaid
flowchart LR
  DEV["GPS devices"] -- "TLS + device credential<br/>or authenticated legacy gateway" --> FLYI["Fly.io: ingest edge<br/>always-on, multi-instance<br/>admission + presence"]
  USERS["Browsers / mobile"] -- HTTPS --> CF["Cloudflare DNS/WAF"]
  CF --> VERCEL["Vercel: apps/web"]
  CF --> FLYA["Fly.io: apps/api<br/>(Workers-portable)"]
  FLYI -- "HTTP + token" --> FLYA
  FLYA --> PGPROD[("Managed Postgres 16<br/>India region")]
  FLYA --> REDISPROD[("Managed Redis 7<br/>India region")]
  CRON["apps/jobs scheduler"] --> PGPROD
  CRON --> R2b[("Cloudflare R2")]
  PROM["Prometheus + Grafana<br/>(ops/: SLO dashboard,<br/>burn-rate alert rules)"] -. "scrape /metrics<br/>api · ingest · jobs" .-> FLYA
  PROM -.-> FLYI
  SENTRY["Sentry"] -. "DSN-gated, dependency-free<br/>transport in all apps" .-> FLYA
```

Local development replaces all of this with `docker compose` (Postgres 16 + Redis 7) and
`pnpm api:dev / ingest:dev / web:dev`; a built-in simulator (`pnpm --filter @trackflow/ingest sim`)
feeds the map without hardware.

The production security profile and cost-conscious regional choice are defined
in [production-edge-and-topology.md](case-study/production-edge-and-topology.md).
IMEI-only internet exposure is not the target production identity model.
