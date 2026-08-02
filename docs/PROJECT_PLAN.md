# TrackFlow — Master Project Plan

The single source of truth for **what is built** and **what is left** to make TrackFlow a complete,
sellable, self-sufficient fleet-tracking SaaS. Derived from the original PRD, reconciled against an
audit of the actual codebase.

- **Last audited:** 2026-05-23 (full source audit of every app + package). **2026-06-12:**
  re-verified typecheck + unit tests green across all 10 packages; published [PRD v2](PRD.md)
  (requirements + NFR/SLO bar + GA criteria); added **Tier 4** below (enterprise-grade completion).
  **2026-07-29:** reconciled the merged security and CI evidence and moved the
  live P0/P1/P2 gates to [Production readiness](PRODUCTION_READINESS.md).
- **Companion docs:** [PRD](PRD.md) (requirements, NFRs, GA criteria) · [README](../README.md)
  (architecture) · [Getting Started](GETTING_STARTED.md) (user guide) ·
  [Deployment](../DEPLOY.md) (go-live) · [Practical-use roadmap](ROADMAP.md)
  (Phases A–E, **shipped** — folded into the matrix below).

> **How to use this doc:** Section 3 is the audit (truth as of today). Section 4 is the prioritized
> forward roadmap with checkboxes — work top-down and check items off. Section 5 is the cross-cutting
> hardening backlog. Keep this file updated as the plan of record.

---

## 1. Where we are today

The core product works end-to-end and is verified with simulators + a local Postgres:

```
GPS device ──TCP──▶ apps/ingest ──HTTP──▶ apps/api ──▶ Postgres (RLS, tenant-isolated)
(GT06/H02/           (in-house          (Hono)         │
 Teltonika/NMEA)      decoders)                         └──SSE──▶ apps/web (Next.js + MapLibre)
                                            apps/jobs (trip rollup, weekly report)
```

A real or simulated device of any of the four protocols appears live on the map, its history replays,
geofence crossings raise alerts, trips/analytics compute, billing quotas enforce, and webhooks fire —
all multi-tenant with Postgres row-level security. The dashboard is ~95% wired to real APIs.

**The one structural constraint** (unchanged, by design): the GPS ingest service is always-on (devices
hold open TCP sockets) and currently **single-instance**. Everything else scales toward zero idle cost.

---

## 2. Status legend

| Marker | Meaning |
|---|---|
| **DONE** | Implemented, wired to real APIs, and verified. |
| **PARTIAL** | Works but has a stub/mock path, missing sub-features, or is dev-only. |
| **TODO** | Not implemented (or comment-only). |

---

## 3. Capability matrix — PRD scope vs. reality

### Tracking core
| Capability | Status | Notes |
|---|---|---|
| In-house protocol decoders | **DONE** | GT06/GT06N, H02, Teltonika Codec 8/8E + Codec 12, NMEA 0183, Queclink, Meitrack — with CRC/checksum (CRC-16/IBM, CRC-16/ITU-T, XOR), encoders, byte-level tests, ACK replies. |
| TCP ingest (multi-port, sessions, IMEI binding) | **DONE** | `apps/ingest`: ports 5023/5013/5027/5004/5073/5020; per-socket session; HTTP sink to API with shared token. |
| Device simulator + demo seed | **DONE** | `apps/ingest/sim/` replays a moving device; `seed` creates a demo fleet. |
| Live map + real-time updates | **DONE** | MapLibre + SSE; heading-aware markers; track trail; device side panel. |
| Position history / replay | **DONE** | `GET /devices/:id/history` (range, capped); rendered as a track layer. |
| Telemetry / sensor data | **DONE** | `attributes` jsonb per position + `last_attributes` per device; ignition, voltages, battery, temperature, signal, etc.; rendered in a telemetry panel. |

### Devices & vehicles
| Capability | Status | Notes |
|---|---|---|
| Device CRUD + active/inactive | **DONE** | Create/edit/delete; admin status separate from live/offline freshness. |
| Live/offline correctness | **DONE** | Derived from `lastSeen`; offline sweep flips stale devices and fires `device.offline`/`device.online`. |
| Vehicles + multiple devices per vehicle | **DONE** | `vehicles` entity; assign/detach devices; aggregated telemetry across attached devices. |
| Per-device connection guide | **DONE** | IMEI + host:port + copy-paste SMS sample per protocol. |
| **Device groups** | DONE (backend) | `/device-groups` CRUD + group-targeted geofences; UI views remain. |

### Geofencing
| Capability | Status | Notes |
|---|---|---|
| Geofence engine (circle + polygon + dwell) | **DONE** | Haversine + ray-casting + entry/exit/dwell with throttling; state persisted. |
| Geofence CRUD + enable/disable | **DONE** | API + UI; per-geofence alert channels + notify emails. |
| Polygon drawing in the UI | **DONE** | Circle/Polygon toggle in the create form; click to add vertices, double-click to close; GeofenceMap renders both circle and polygon geofences. |
| Assign geofence to groups | **DONE** | `geofences.groupIds` jsonb; `evaluateGeofences` pre-loads device group memberships and matches allDevices / explicit deviceIds / group-includes-device. |

### Alerts & notifications
| Capability | Status | Notes |
|---|---|---|
| Alert records + live feed + acknowledge | **DONE** | Severity, real-time SSE, ack. |
| Email / SMS / Push / Webhook channels | **DONE** | Resend / MSG91 / Expo / signed HTTP — real adapters (key-gated). |
| **WhatsApp channel** | DONE | Meta Cloud API; key-gated, registered in the channel registry. |
| Templates, quiet hours, throttling, schedules | **DONE** | `notification_templates` (per-tenant overrides, `{{var}}` substitution, en/hi defaults); `tenant_notification_settings` with timezone-aware quiet hours (midnight-crossing supported); per-(device,event) hourly throttle; criticalBypass; `notification_routes` for per-event channel routing. |
| Delivery-status log + retries | **DONE** | `alert_deliveries` + `webhook_deliveries` rows per attempt; `apps/jobs/notify-retry.ts` re-tries failed deliveries with exponential backoff. |

### Trips, analytics & reports
| Capability | Status | Notes |
|---|---|---|
| Trip detection + scoring | **DONE** | Stop/idle/gap heuristics; distance, avg/max speed, speeding samples, driver score. |
| Analytics endpoints + dashboard | **DONE** | `/summary`, `/distance-by-day`, `/export` (CSV); Recharts dashboard. |
| Trip rollup job | **DONE** | `apps/jobs/rollup.ts`, idempotent windowed re-insert. |
| Scheduled reports | **DONE** | `apps/jobs/report.ts` builds a weekly CSV + emails it via the notifications registry; archives to S3/R2 via `@trackflow/storage` when storage is configured (otherwise falls back to local `REPORT_DIR`); cron uses an in-repo `apps/jobs/scheduler.ts` runner. PDF format shipped too (`report-pdf.ts`, pdf-lib, paginated A4 table; CSV + PDF both archived). |

### Billing & plans
| Capability | Status | Notes |
|---|---|---|
| Plan definitions + device/user quota enforcement | **DONE** | free/starter/professional/enterprise; quota blocks on create/invite. |
| Razorpay integration | **DONE** | Real order creation + webhook HMAC verify; `/confirm` is dev-only (returns 403 in production). |
| **Stripe (international)** | **DONE** | `/billing/checkout-stripe` creates a real Checkout Session (form-urlencoded → `/v1/checkout/sessions`); `/internal/billing/stripe` verifies the Stripe-Signature (v1 HMAC + 5-min timestamp tolerance) and upgrades on `checkout.session.completed` (paid). Key-gated mock fallback; idempotent on redelivery via `applyUpgrade`'s `providerRef` check. |
| GST invoices | **DONE** | Computed + stored as DB rows (18% GST); downloadable PDF via `apps/api/src/invoice-pdf.ts` at `GET /billing/invoices/:id/pdf`. PDFs are archived to S3/R2 on upgrade (when configured) and the download endpoint redirects to a 5-minute pre-signed URL. |
| Usage metering (SMS/API) + overage/grace | **DONE** | `usage_counters` per (tenant, month); `meterApiCall` runs on every API-key request; SMS/Email/WhatsApp dispatches are metered; overage computed against the plan's includedUnits at billed rates; `closePeriodOverages` writes a metered invoice for the period. |
| Self-serve upgrade/downgrade/cancel | **DONE** | Upgrade via Razorpay / Stripe / dev `/confirm` → `applyUpgrade`; downgrade via `/billing/downgrade` (blocked if usage exceeds target limits); cancel via `/billing/cancel` (paid access until period end, then `apps/jobs/subscriptions.ts` reverts). |

### Multi-tenancy & auth
| Capability | Status | Notes |
|---|---|---|
| Postgres RLS tenant isolation | **DONE** | FORCE RLS on 11 tenant tables; non-superuser runtime role; per-request GUC; isolation test in CI. |
| Roles & permissions | **DONE** | owner/admin/manager/user/viewer + scope checks. |
| JWT access + refresh, PBKDF2 passwords | **DONE** | jose HS256; edge-portable Web Crypto hashing. |
| Refresh-token rotation + revocation + logout | **DONE** | Per-jti `sessions` rows; `/auth/refresh` rotates (revokes presented, issues fresh); replay of an already-rotated token detected & kills the chain; `/auth/logout` revokes a specific session; `/me/sessions` lists active sessions; `/me/sessions/revoke-all` signs out every device. |
| Password change / reset / email verification | **DONE** | `/auth/password/forgot` + `/auth/password/reset` (consumable tokens); `/auth/verify-email`; `/me/password` authenticated change (revokes all refresh sessions on success). |
| **Multi-org membership + org switching** | DONE | `org_memberships` table (back-filled from `users.tenantId`); `GET /me/memberships` + `POST /me/switch-org` mint fresh tokens for any membership the user owns. |
| User invite | **DONE** | Creates user + temp password; sends an invite email via `sendEmail` (Resend-backed when configured) with sign-in link; mirrors an `org_memberships` row; records an audit entry. Temp password is also returned to the inviter so they can hand it over directly if email delivery isn't set up yet. |

### Public API, webhooks & integrations
| Capability | Status | Notes |
|---|---|---|
| API keys (scoped, hashed) | **DONE** | `tf_live_` prefix, SHA-256 stored, scope-checked. |
| Webhooks (signed + retry/backoff) | **DONE** | HMAC-SHA256, 3 attempts with backoff, success/failure counters. |
| **Webhook delivery log + edit + per-event/per-device filtering** | DONE | `webhook_deliveries` (per-attempt), PATCH endpoint, per-device allow-list, GET /webhooks/:id/deliveries. |
| Rate limiting | **DONE** | 600 / 60s per user, 6000 / 60s per API key (configurable); Upstash Redis REST store when `UPSTASH_REDIS_REST_URL` is set (multi-instance ready), in-memory fallback for single-instance dev; per-IP throttle on `/auth/*` and `/admin/*` in production. |
| OpenAPI / `/docs` | DONE | Hand-maintained `openapi.ts` covers every router with shared error responses and four security schemes; integrity unit-tested. |
| GraphQL | **DONE** | Read-only `/graphql` over `graphql-yoga`, authenticated by the same JWT/x-api-key middleware as REST. Schema covers `me`, `devices`, `device(id)`, `geofences`, plus nested `Device.lastPosition / positions(from,to) / trips`. Resolvers run inside `withTenant` so RLS isolates rows. Mutations stay on the REST surface (where input validation + audit + quota live). 5 gated tests cover unauth, RLS scoping, cross-tenant null, and GraphQL-spec error envelope. |

### White-label & enterprise
| Capability | Status | Notes |
|---|---|---|
| Branding (name/logo/color) + public theming | **DONE** | Per-tenant; public lookup themes the login page. |
| Custom domains (DNS/TLS automation) | **DONE** | `/branding/custom-domain` (PUT / GET / DELETE / POST refresh) provisions a Cloudflare for SaaS custom hostname (`POST /zones/{zone}/custom_hostnames`), stores the activation status + DNS ownership-verification challenge, and tears it down on removal. Gated on `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` (without them the endpoint accepts the hostname locally and reports `status=mock` so dev work is not blocked). 8 tests cover mock + real (stubbed-fetch) paths. |
| SCIM 2.0 provisioning | **DONE** | `/scim/v2/{ServiceProviderConfig,Users,…}` with bearer-token auth (API key with `scim:provision` scope). Supports filter, paging, create/replace/patch/delete; PATCH active=false deprovisions; SCIM error envelope on failures; 8 gated tests cover auth + scope + each verb. |
| SSO / SAML | **DONE** | Per-tenant `saml_configs`; tenant admin CRUD via `/saml-config`; public SP flow at `/auth/saml/<slug>/{metadata,login,acs}` using `@node-saml/node-saml`. ACS verifies the signed assertion, just-in-time-provisions an unknown email with the tenant's `defaultRole`, mints TrackFlow tokens, and redirects to the dashboard with the access token in the URL fragment. 11 tests (profile extraction + CRUD + metadata + login redirect + ACS guard). |
| Audit logs | **DONE** | Append-only `audit_logs` table; RLS-scoped; recorded on user invite/remove/password-change/sessions-revoke, billing downgrade/cancel, webhook CRUD, SCIM provisioning/deprovisioning. Listed via `GET /audit-logs` (requires `users:manage`). |

### Mobile
| Capability | Status | Notes |
|---|---|---|
| Login + device list + foreground GPS reporting + push registration | **DONE** | Expo app; reports real GPS in the foreground. |
| Background tracking + offline queue/sync | **PARTIAL** | Offline queue done (`apps/mobile/src/lib/offline-queue.ts`): persistent FIFO over a storage abstraction, bounded (default 2k), flush stops on first failure for chronological correctness; tracking.ts persists fixes on send failure and drains on the next success. Background task via `expo-task-manager` still requires a real RN device to wire. |
| Push deep-linking | **DONE** | Backend `ExpoPushChannel` carries `alertId`/`deviceId`/`geofenceId` in the push payload. Mobile `App.tsx` listens via `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` (cold-start), routes to `AlertDetailScreen` which fetches `/alerts/:id` and supports ack. |
| Map view (in-app) | **TODO** | No in-app map yet — `react-native-maps` integration deferred until a real RN device is available. |
| In monorepo build/CI | **DONE** | Separate `mobile-test` CI job: installs deps with `npm --legacy-peer-deps` inside `apps/mobile` (excluded from pnpm workspace due to native modules) and runs `npm test` (vitest). All 13 mobile tests (offline-queue + deep-link) run in CI. EAS/TestFlight builds need a real device + EAS project. |

### Protocols (breadth)
| Capability | Status | Notes |
|---|---|---|
| GT06 / H02 / Teltonika Codec 8/8E / NMEA | **DONE** | ~80% of the India market + pro + raw. |
| Quectel (Queclink), Teltonika Codec 12 (commands), Meitrack | **DONE** | Queclink GTFRI/GTHBD/alarm + Meitrack AAA with XOR checksum + Codec 12 commands. Encoders + ≥7 byte-level tests each. |
| OBD-II fields | **DONE** | Teltonika AVL IO IDs 30–60 mapped to canonical OBD-II PIDs (coolant, RPM, throttle, fuel trim, ambient temp, etc.) with signed/scaled transforms. |
| MQTT ingest | **DONE** | `apps/ingest/src/mqtt.ts` subscribes to `trackflow/<protocol>/<imei>/up`, decodes each payload via the shared registry (per-IMEI session) and forwards to the API sink. Gated on `INGEST_MQTT_URL`; off by default. 6 unit tests cover topic parsing, decode + forward, unknown-protocol no-op, session reuse, IMEI binding. |
| Two-way device commands | **PARTIAL** | Durable generic queue/state machine is shipped. Redis wakes the admitted holder and poll-on-connect remains the fallback; automatic wire delivery is deliberately limited to non-destructive `request_location` on GT06/Teltonika pending physical acceptance. |

### Data & infrastructure
| Capability | Status | Notes |
|---|---|---|
| Relational schema + Drizzle migrations | **DONE** | 30+ tables, 24 committed migrations (0000…0024). |
| `positions` time-partitioning | **DONE** | Monthly RANGE partitioning by `fix_time` (migration 0006) with provision/drop helpers (`trackflow_provision_positions_partitions`, `trackflow_drop_positions_partitions_before`). |
| Retention job (drop old partitions per plan) | **DONE** | `apps/jobs/src/retention.ts` — provisions a forward window of partitions, purges per-tenant rows older than the plan's `historyDays`, drops fully-expired month partitions when no unlimited-retention tenant remains. |
| Observability (Sentry, structured logs, metrics) | **DONE** | Sentry DSN gated (`SENTRY_DSN`); structured per-request logs (requestId/tenantId/userId); ingest-health job + alerts; `startup-checks` smoke test that the API can read RLS + serve `/health`; observability + sentry unit tests in CI. |
| Backups + restore drill | **PARTIAL** | Neon PITR is the source-of-truth; `packages/db/scripts/verify-restore.ts` validates that a restored DB still has all required tables + partitions; the drill itself is documented but not automated end-to-end. |
| Multi-instance ingest strategy | **DONE** (foundation) | `apps/ingest/src/session-store.ts` provides a pluggable `SessionStore` (Upstash REST when `INGEST_REDIS_URL`/`INGEST_REDIS_TOKEN` set, in-memory fallback otherwise) keyed on `protocol:peer` for IMEI binding and on IMEI for the owning `INGEST_POD_ID`. The TCP server restores IMEI on connect so a reconnect landing on a different pod resumes without waiting for re-login. NLB/ALB in front for multi-instance is a hosting concern that doesn't need code. |

---

## 4. Forward roadmap

Prioritized for a bootstrapped SaaS: first make it **safe to run with paying customers**, then
**competitive**, then **enterprise-grade**. Work top-down; check items off here.

### Tier 1 — Make it sellable & safe to operate

#### M1 — Billing for real
Goal: take real money and prove the upgrade loop without the dev mock.
- [x] Drive upgrades **only** from the verified Razorpay webhook; the dev `/confirm` is gated in production (403). The webhook handles `payment.captured`/`order.paid`, verifies the HMAC in constant time, and is **idempotent on redelivery** (keyed on provider payment ref). Frontend checkout wired (`startCheckout`): opens the Razorpay modal when keys are configured, falls back to the confirm endpoint in dev (verified). The live modal/payment path is code-complete but not browser-/payment-tested in this sandbox. Covered by gated API integration tests (`apps/api/src/billing.test.ts`).
- [x] Add Stripe (international cards) behind the same plan-change service — Checkout Session + webhook live alongside Razorpay.
- [x] **GST PDF invoices**: on-demand `GET /billing/invoices/:id/pdf` (RLS-scoped) renders a GST tax invoice (CGST/SGST split, seller details from env) with pdf-lib; the Billing screen links a per-invoice download. R2 caching deferred — on-demand generation is cheap.
- [x] **Downgrade** (guardrailed — blocks if current usage exceeds the target's limits), **cancel** (paid access until period end, then `jobs:subscriptions` reverts to free), and a **14-day trial** of a paid plan started on signup with an in-app countdown + cancel UI. Tested via API route tests + a jobs expiry test. Monetary **proration/refunds deferred** (needs the payment provider).
- [x] `usage_counters` (per-tenant, per-month) meters API-key calls + delivered SMS; the monthly **API quota is enforced** (402 when over, with a configurable grace buffer via `USAGE_GRACE_FRACTION`) and usage shows on the Billing screen. SMS is metered but not capped (plans define no SMS limit yet — follow-up). Gated tests cover counting + enforcement.
- **Exit:** a real test-mode payment upgrades the plan via webhook, produces a downloadable GST PDF, and the 6th device on Starter is blocked with an upgrade prompt.

#### M2 — Auth & account hardening
Goal: real account lifecycle and session safety.
- [x] Refresh-token **rotation** (each `/refresh` revokes the used session and issues a new one), **revocation** + **reuse detection** (replaying a rotated token kills the whole chain), and server-side **logout** (`POST /auth/logout`). Backed by a jti-keyed `sessions` table; gated API tests cover rotation, reuse, and logout. (Access tokens still expire naturally within `accessTtl`; immediate access-token revocation is a follow-up.)
- [x] **Password reset** (`/auth/password/forgot` → emailed single-use link → `/auth/password/reset`, which rotates the password and revokes all sessions) and **email verification** (verification email on signup → `/auth/verify-email`). Backed by hashed, single-use, expiring `auth_tokens` + `users.email_verified_at`; delivery via the Resend channel (no-op in dev). Gated tests cover reset, single-use, no account-enumeration, and verify.
- [x] Send the **invite email** on user invite (delivery via the Resend channel; the temp password is still returned for dev fallback).
- [x] Password **strength** check (letters + numbers) on register + reset and a min-length on the login schema; **account deletion** (`DELETE /users/:id`, guarding against removing the last owner).
- [x] Pluggable rate-limit store — `MemoryStore` default, **Upstash** Redis adapter when `UPSTASH_REDIS_REST_*` is set — with a separate, higher **per-API-key** limit bucketed per key. In-memory + per-key behaviour are unit-tested; Upstash is the (unmetered) prod path.
- **Exit:** a user can verify email, reset a password, log out (token rejected after), and rate limits hold across multiple API instances. ✅ (multi-instance holds once Upstash is configured in prod)

#### M3 — Data scaling, retention & backups
Goal: the hot path stays fast and storage stays bounded as data grows.
- [x] Convert `positions` to **monthly declarative partitions** — migration 0006: native RANGE-by-`fix_time`, composite PK `(id, fix_time)`, a DEFAULT catch-all so ingest never drops a fix, and `SECURITY DEFINER` provisioning/drop functions the app role can call.
- [x] **Retention job** (`apps/jobs/src/retention.ts`, `pnpm jobs:retention`): per-tenant row retention by plan `historyDays` (7/90/365/∞), drops fully-expired partitions (never while an unlimited-retention tenant exists), and provisions upcoming months. Verified end-to-end against Postgres + RLS isolation re-checked on the partitioned table.
- [x] **Daily rollups**: a `daily_rollups` table (per device-day — trips, distance, duration, max speed, speeding) rebuilt idempotently by the rollup job (`rebuildDailyRollups`, upsert on device+day) right after trip detection. `/analytics/summary` and `/distance-by-day` now read the rollup, so query cost scales with days-in-range rather than trip count; `/export` keeps per-trip detail. Gated tests cover the rollup aggregation/upsert and the analytics read path.
- [x] Documented + **verified restore drill** from Neon PITR: a read-only verifier (`pnpm --filter @trackflow/db db:verify-restore`, with the Neon PITR runbook in its header comment) asserts a restored DB is coherent — migrations at HEAD, core tables present, RLS enabled on every tenant table, and `positions` still partitioned. It passes against a migrated DB and exits non-zero on a broken one. (Executing the actual Neon PITR branch-restore is a manual ops step; the verifier is what makes the drill repeatable and checkable.)
- **Exit:** positions writes/reads hit partitions; a retention run drops an out-of-window partition; a restore is performed on a scratch DB (then validated with `db:verify-restore`).

#### M4 — Observability & reliability
Goal: know when something breaks before customers do.
- [x] Structured request logs with request-id + tenant/device context ✅ (apps/api — every request carries an `x-request-id` and logs principal/tenant context). **Sentry** error capture wired in all three apps via the same lightweight DSN-gated HTTP transport (no `@sentry/*` SDK — adds <2 KB per app instead of ~200 KB), living in `@trackflow/shared`: API (`apps/api/src/observability.ts`, forwards 500s; unit-tested DSN parse + event payload), ingest (`apps/ingest/src/observability.ts`, `trackflow-ingest` logger: process-level uncaught/unhandled handlers, listener errors, and decoder crashes — a malformed frame is captured + the socket buffer dropped instead of killing the listener), web (`apps/web/src/lib/observability.ts` + `ErrorListener` global handlers in `app/layout.tsx` for `window.error` + `unhandledrejection`; api client forwards 5xx responses). Reads `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (web); no-op when unset.
- [x] **Alert on ingest downtime** (the always-on dependency): a watchdog (`runIngestHealthCheck`, scheduled every minute) treats the freshest `devices.last_seen` across the fleet as the ingest-liveness signal and dispatches a `critical` alert (console + email) when it goes stale while active devices exist. `checkIngestHealth` exposes a per-tenant/global freshness snapshot for health/metrics scraping. Gated tests cover healthy / stale / no-active-devices. (The metrics *dashboards* are external wiring on top of this signal.)
- [x] In-repo **scheduler** (`pnpm jobs:scheduler`): runs rollup / retention / subscriptions / report on env-tunable intervals in one long-lived process, each run isolated so a failing job never stops the loop. Jobs refactored to export pure run functions (no `process.exit`) behind a guarded CLI self-exec. Unit-tested with fake timers (interval cadence + failure isolation).
- [x] **Load-test CI gate**: `loadtest/run.mjs` enforces a p95 budget (`P95_BUDGET_MS`) + max error rate, exiting non-zero on regression; the CI workflow boots the API and runs it as a gate step. Verified end-to-end against a running API — PASS/exit 0 under budget, FAIL/exit 1 when tightened.
- **Exit:** killing ingest triggers an alert ✅; CI fails if p95 regresses past budget ✅; a forced error is reported with tenant context ✅ (via `reportError`, forwarded to Sentry when `SENTRY_DSN` is set).

### Tier 2 — Make it competitive & sticky

#### M5 — Notifications depth
- [x] **Template engine** (per-event, per-tenant, i18n en/hi) with variables — `notification_templates` table (tenant × event × locale, active flag) + a `template-service` that resolves through tenant overrides → built-in defaults and renders `{{var}}` placeholders (missing vars empty; never throws). Built-in en + hi defaults for `geofence.enter` / `geofence.exit` / `device.offline` / `ingest.downtime`; `tenants.locale` carries the tenant's preferred language. Pure-render unit tests + gated resolution/locale-fallback/tenant-override tests.
- [x] **Quiet hours**, **throttling**, **per-channel routing rules**, and **template wiring** all done. `tenant_notification_settings` carries a timezone-aware quiet-hours window (midnight-crossing supported), a per-`(device, event)` hourly throttle, and a `criticalBypass` flag. `notification_routes` (per-tenant, per-event) override an alert's authored channel list when a row matches. `alert-dispatch` now also renders content through the template engine — bulk-loading deviceName/geofenceName variables, falling back to the alert's pre-rendered title/message when no template covers the event — so tenant overrides + locale + variables actually drive what gets sent. Suppressed alerts are still recorded with status `skipped`. Gated tests cover settings persistence + defaults, the rendered subject/body landing in the delivery log, and per-event route overriding the alert's channels. (Recurring **schedules** for proactive sends — e.g., scheduled reports — are a separate cron concern, not part of alert dispatch.)
- [x] Persisted **delivery log** + automatic **retries** + status surfaced in UI — `alert_deliveries` records one row per dispatch attempt (channel/recipient/status/attempt/error/nextRetryAt); `alert-dispatch` writes them, scheduling `nextRetryAt` for transient failures on retryable channels. A `notify-retry` job (scheduled every minute, `pnpm jobs:notify-retry`) re-dispatches due failures with exponential backoff until success or the attempt cap (then `abandoned`). `GET /alerts/deliveries` (RLS-scoped, filterable by alertId/status) exposes the log; web api client + type wired. Gated tests cover recording's retry-scheduling and the job's sent/requeue/abandon/not-due transitions. (UI table rendering pending browser verification.)
- [x] **WhatsApp via Meta Cloud API** — `WhatsappChannel` POSTs text messages to `graph.facebook.com/v22.0/{phoneId}/messages` with `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID`; key-gated (skips per recipient when unset) and registered in the channel registry (api + notify-retry job). Unit-tested for the no-config skip, the request payload/auth/URL, HTTP non-2xx failure, and network-error capture. (For production outside the 24h window, operator-approved templates are the next layer.)
- **Exit:** a geofence alert respects quiet hours, renders from a tenant template, is delivered over WhatsApp + email, and its delivery status is visible and retried on failure.

#### M6 — Map & geofence UX
- [x] **Polygon drawing** in the geofence UI — Circle/Polygon toggle, click to add vertices, double-click to close.
- [x] Marker **clustering** — GeoJSON cluster source (maxZoom 12); click-to-expand; individual markers visible at high zoom.
- [x] Trail **playback scrubber** — Play/Pause + range input below the map; playhead dot follows position; device card shows historical speed/heading/coords.
- [x] Geofence editing — inline pencil-icon panel edits name, on-entry/exit, channels, notify emails.
- [x] **Device groups** + group-level geofence assignment ✅: `device_groups` + `device_group_members` tables, CRUD at `/device-groups` (+ `PUT /:id/devices` set-semantics), `geofences.groupIds` fires for any device in listed groups. Web UI (`/device-groups` page): list with colored dot + member count, create form (name/description/6 preset colors), inline edit, member checklist panel, delete. Added to sidebar nav as "Groups". Gated tests cover CRUD/membership and group-targeted geofence firing.
- **Exit:** a user draws a polygon zone, assigns it to a device group, and scrubs a device's route playback.

#### M7 — Public API & integrations
- [x] Complete the **OpenAPI** spec for every router; error schemas; examples — the spec (`apps/api/src/openapi.ts`, served at `/openapi.json`, Scalar UI at `/docs`) now covers Auth, Devices, Vehicles, Geofences, Alerts (incl. `/alerts/deliveries`), Analytics, Billing (incl. plans, invoices, PDF, checkout, downgrade, cancel), API Keys, Webhooks (CRUD + PATCH + `/deliveries`), Branding (incl. public lookup), Users, Push, Admin (token-gated), Ingest (token-gated), and Health. Components define the canonical Error envelope, all entity shapes, and shared 400/401/403/404/429 responses; four security schemes (`bearerAuth`, `apiKeyAuth`, `adminAuth`, `ingestAuth`) cover every gating mode. A unit test validates `$ref` integrity, security-scheme references, and per-operation completeness.
- [x] Webhook **delivery log + edit endpoint + per-event/per-device filtering** — `webhook_deliveries` records one row per HTTP attempt (event, attempt, status, http status, error, duration); `webhooks.deviceIds` adds a per-device allow-list (empty = all); `deliverEvent` honours both the event subscription and the device filter; `PATCH /webhooks/:id` edits any subset of name/url/events/deviceIds/status; `GET /webhooks/:id/deliveries` (RLS-scoped, status filter) exposes the log. Gated tests cover the success-on-first-attempt + retry-on-failure logs, the PATCH, the log endpoint, and the per-device filter, using a tiny local HTTP server as the receiver.
- [x] Optional **GraphQL** endpoint (read-only; graphql-yoga; RLS-scoped via withTenant).
- [x] Developer portal — `ApiKeysSection` covers 12 scopes; `WebhooksSection` has an expandable per-webhook delivery log (last 10); settings page links out to the `/docs` API reference.
- **Exit:** an external integrator drives the full API from `/docs`, subscribes a filtered webhook, and inspects deliveries.

### Tier 3 — Enterprise & breadth

#### M8 — White-label & enterprise
- [x] **Custom-domain** automation via **Cloudflare for SaaS** (hostname + TLS, with mock fallback when not configured).
- [x] SCIM 2.0 provisioning (Okta/Azure AD compatible; bearer-token auth via API-key scope).
- [x] **SSO/SAML** — `@node-saml/node-saml` SP, per-tenant config, JIT user provisioning on a valid assertion.
- [x] **Multi-org membership + org switching** + **audit logs of admin actions**. `org_memberships` (per-user, per-tenant, role) is back-filled from existing users; register + invite both insert a row alongside the existing single-tenant flow so legacy behaviour is unchanged. `GET /me/memberships` lists the user's orgs (joined with tenant name/slug + the active tenant id); `POST /me/switch-org` mints fresh tokens scoped to a target tenant after verifying membership and refuses with 403 otherwise. `audit_logs` (RLS-scoped) + `recordAudit` (actor user, actor IP from fly-client-ip/x-forwarded-for, action, target, metadata) wired into user invite/remove, billing downgrade/cancel, and webhook create/update/delete; the audit insert is awaited so an immediate `GET /audit-logs` read is consistent. Gated tests cover register-creates-membership, switch-into-allowed-org, refuse-non-member, and that invite + remove rows land with correct actor/target/metadata.
- **Exit:** a tenant serves the dashboard on its own domain with TLS and logs in via SAML; an admin can switch orgs.

#### M9 — Protocol breadth & device commands
- [x] **Teltonika Codec 12** (command frames) ✅: `encodeTeltonikaCommand` produces the wire format the device expects (`preamble | dataLen | codec=0x0C | count | type=0x05 | size | ascii | count | crc16IBM`), and `parseTeltonikaCommandResponse` decodes the device's `type=0x06` reply with CRC verification. **OBD-II fields** ✅: the Teltonika AVL IO map now translates the standard PIDs (30-60: DTC count, engine load, coolant/intake/ambient temps, fuel trim, fuel pressure, MAP, RPM, vehicle speed, MAF, throttle, EGR, fuel level, barometric, oil temp, fuel rate, …) into canonical units (°C, %, kPa, V, km, L/h) so consumers don't need to know per-PID scaling. Round-trip + CRC-rejection + raw-IO encoder hatch all tested (protocols 47 total). **GT06 command encoding** ✅: `encodeGt06Command(cmd, serial, serverFlag)` builds the 0x80 frame (English lang byte + 4-byte server flag + ASCII command, e.g. `RELAY,1#` to immobilize); `parseGt06CommandResponse` decodes the device's 0x15 reply with CRC-ITU verification. 5 round-trip tests added. Quectel / Meitrack decoders and MQTT ingest are all done (see status table).
- [~] **Two-way commands**: the durable state machine, tenant API, ingest pickup/ack endpoints, Redis holder wake-up, stale-session protection, and poll-on-connect fallback are shipped. Automatic socket delivery is restricted to `request_location` on GT06/Teltonika; safety-sensitive commands remain blocked on approval and physical-device evidence.
- **Exit:** a new protocol decodes against captured frames; an immobilize command round-trips to a device/simulator.

#### M10 — Mobile to GA
- [~] **Background tracking** + **offline queue/sync** — offline queue done; background-task wiring needs a real RN device.
- [~] In-app **map view**; push **deep-linking** to the relevant screen — deep-linking done (`AlertDetailScreen`); in-app map deferred.
- [~] Fold mobile into CI ✅ (`mobile-test` GitHub Actions job; 13 vitest tests); **TestFlight/Play** builds via EAS need a real device + EAS project.
- **Exit:** a backgrounded phone reports location reliably, queues offline, and a push opens the right screen.

### Tier 4 — Enterprise-grade completion (GA hardening)

Closes the gap between "feature-complete" and the GA bar defined in [PRD §7](PRD.md#7-release-criteria-ga-definition).
Sequence: **M11 → M12 → M13** can run in parallel with **M15**; **M14** after M12.

#### M11 — Security & compliance to certification-grade
Goal: pass an enterprise security review and the PRD's OWASP ASVS L2 / SOC 2-readiness bar.
- [x] **MFA (TOTP)** + recovery codes + per-tenant enforcement — dependency-free RFC 6238 TOTP in `@trackflow/shared` (Web Crypto HMAC-SHA1, base32, RFC test vectors); enrollment at `/me/mfa/{setup,enable,disable}` (secret + otpauth URI shown once; 10 hashed one-time recovery codes returned once; disable requires a valid code); login returns a 5-min single-use `mfa_challenge` instead of tokens, completed at `/auth/mfa/verify` (wrong codes don't burn the challenge; recovery codes consumed on use); `tenants.require_mfa` (`PUT /users/mfa-requirement`, `users:manage`) flags un-enrolled logins with `mfaSetupRequired`; audit entries on enable/disable/policy change; web login 2-step + Settings → Security section; OpenAPI documented (incl. backfilling the whole `/me` surface); migration 0026; 8 unit + 5 gated API tests. (Web flows typecheck/build-verified; browser pass pending.)
- [x] **Security headers** — API: `hono/secure-headers` (nosniff, frame, COOP; HSTS in production; CORP relaxed for the cross-origin dashboard). Web: CSP (script limited to self + Razorpay; MapLibre blob workers; https: img/connect for operator-configured tile/logo hosts), HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy via `next.config.mjs`. (CSP needs a browser regression pass alongside the Next 15 upgrade.)
- [x] **CI security gates** — `.github/workflows/security.yml`: pnpm audit (fail on high), Semgrep SAST (`p/ci` + `p/typescript`), gitleaks full-history secret scan, CycloneDX SBOM artifact; weekly schedule + PRs; Dependabot (npm grouped minor/patch + actions). Merged-main Security run `30430688995` passed all four jobs after PRs #7 and #9.
- [x] **Next.js 16 upgrade** (15 was already EOL-bound; jumped straight to 16.2 + React 19.2) — clears the Next DoS/SSRF advisories from §5; vitest bumped to v3 + a `shell-quote` override so **`pnpm audit --audit-level high` is clean**; the standalone mobile npm lockfile is also clean. `next lint` was removed because Next 16 deleted it. Typecheck + build are green; **full browser regression still remains in issue #20** (also covers the new CSP).
- [x] **DPDP/GDPR data-subject rights** — `GET /me/export` (owner-only) returns the full workspace bundle as a JSON download: tenant, sanitized members (no hashes/secrets), devices, vehicles, groups, geofences, alerts, trips, invoices, audit logs, API-key/webhook metadata, newest 50k positions with a `positionsTruncated` flag. `DELETE /me/tenant` (owner-only) hard-deletes the workspace after password + typed-phrase confirmation: purges positions (RLS-scoped), cascades everything else from the tenants row, logs the deletion to the structured log (the audit trail dies with the tenant). Settings → Security gains Export + a Delete-workspace danger zone; `/privacy` + `/terms` pages added and linked from the auth screens. OpenAPI documented; 3 gated API tests (scoping + sanitization, non-owner 403, wrong-password/phrase guards + cascade verification). Sub-processor list ([docs/SUB_PROCESSORS.md](SUB_PROCESSORS.md)) + breach-notification runbook ([docs/RUNBOOKS.md](RUNBOOKS.md) RB-6) shipped — this item is complete.
- [ ] **SOC 2 Type II readiness**: written policies (access, change-mgmt, incident, vendor), quarterly access reviews, evidence automation; **external pen test** before GA with criticals/highs fixed; `security.txt` + disclosure policy.
- **Exit:** security-review checklist green; pen-test report remediated; a tenant can export and hard-delete their data end-to-end.

#### M12 — High availability & disaster recovery
Goal: remove the ingest SPOF and make recovery a routine, automated event (PRD §6.2: API 99.95%, ingest 99.9%, RPO ≤ 5 min, RTO ≤ 60 min).
- [~] **Multi-instance ingest**: Redis-backed session/presence maps, holder-targeted command wake-ups, stale-close protection, and poll-on-connect fallback are implemented and locally tested through real Redis. Remaining evidence is hosted multi-replica failure/load behavior under issue #16, not application routing code.
- [ ] **Zero-downtime deploys** (blue/green on Fly) + health/readiness probes on api/ingest/jobs.
- [x] **Automated restore drill**: `.github/workflows/restore-drill.yml` (monthly + manual). The `verify-scratch` job always runs — migrates a fresh Postgres and runs `db:verify-restore`, so schema drift / verifier rot is caught continuously rather than mid-incident. A `verify-neon-pitr` job (manual dispatch) creates a real Neon PITR scratch branch 5 minutes back via `neonctl`, verifies it, and tears it down — auto-skipped unless `NEON_API_KEY` + `NEON_PROJECT_ID` secrets are set.
- [ ] **Public status page** + external uptime monitors (TCP probe on ingest ports, `/health`, web).
- [x] **Runbooks** — [docs/RUNBOOKS.md](RUNBOOKS.md): severity matrix + RB-1…7 (ingest down, DB failover/PITR restore, webhook storm, payment-webhook outage, notification channel down, breach response, deploy rollback).
- **Exit:** killing one ingest pod loses no fixes (devices reconnect to a sibling); the restore drill runs unattended and goes green; status page reflects a forced component outage.

#### M13 — Observability to SLO-grade
Goal: SLOs are measured and alerting is burn-rate-driven (PRD §6.7).
- [~] **OpenTelemetry traces** across web → API → DB; Prometheus `/metrics` on api/ingest/jobs; Grafana dashboards for the golden signals. **API `/metrics` shipped**: dependency-free in-process Prometheus registry (`apps/api/src/metrics.ts`) — `http_requests_total{method,status}`, an `http_request_duration_seconds` histogram per method, and a process-uptime gauge; bounded label cardinality (method+status only, never raw paths); scrape endpoint token-gated via `METRICS_TOKEN` (Bearer), refused in production without a token; logger skips the scrape. 5 unit/route tests; OpenAPI documented. **Ingest `/metrics` + `/health` shipped too**: the always-on ingest service gained its first HTTP surface (`apps/ingest/src/http.ts` on `INGEST_HTTP_PORT`, default 9100) — `ingest_messages_total{protocol,kind}`, `ingest_forwarded_total`, `ingest_decode_errors_total`, `ingest_sink_errors_total`, and an `ingest_active_connections` gauge, same token gating; `/health` gives the status-page/LB a probe target. 6 tests. **Scheduler `/metrics` + `/health` shipped**: the long-lived `jobs:scheduler` process now records each run (`job_runs_total{job,status}`, `job_run_duration_seconds` summary, `job_last_success_timestamp_seconds` gauge) and serves them on `JOBS_HTTP_PORT` (default 9101), same token gating; 4 tests. (One-shot job *invocations* still suit a push-gateway, but the scheduler is the long-lived deployment.) **Grafana dashboard + Prometheus alert rules shipped as code** (`ops/`): `prometheus/alerts.yml` encodes the PRD SLOs — multi-window burn-rate on the API 5xx ratio (99.95% target), p95 < 300 ms, ingest down / no-connections (99.9%), and job-stale/failing alerts; `prometheus/prometheus.example.yml` scrapes all three targets with the Bearer token; `grafana/trackflow-slo-dashboard.json` is an importable SLO board; `ops/README.md` ties it together. JSON + YAML validated. **Remaining**: OTel distributed traces (web→API→DB) and a live Grafana/Alertmanager wiring.
- [x] **Sentry on ingest + web** — ingest ✅ (shared transport from `@trackflow/shared`; decoder-crash containment + process handlers). Web ✅ via the same dependency-free transport (`apps/web/src/lib/observability.ts`, `NEXT_PUBLIC_SENTRY_DSN`-gated, `keepalive` POST) rather than the heavy `@sentry/nextjs` SDK — wired into Next route + global error boundaries (`error.tsx`, `global-error.tsx`) and a window `error`/`unhandledrejection` listener; the prod CSP `connect-src https:` already allows the ingest POST. First web unit-test suite stood up (vitest) covering DSN parse + report/no-op paths, so web now runs in CI. **Browser pass still pending** for the boundary UIs.
- [ ] **SLO dashboards + burn-rate alerts**: API p95, ingest fix-freshness, SSE fan-out lag, webhook/notification failure rate, job-run health.
- [ ] **Synthetic probe**: simulated device fix → assert it appears on the SSE stream < 2 s (the PRD's ingest-to-map p95 metric).
- [ ] Log aggregation with retention (ship structured logs off-box).
- **Exit:** an SLO breach pages before a customer notices; the fix→map latency metric is graphed continuously.

#### M14 — Scale & performance
Goal: hold the PRD design point (50k devices, 10k sockets, p95 < 300 ms) with headroom.
- [ ] Load test to **10k simulated devices** (extend `loadtest/`); tighten the CI p95 budget to 300 ms.
- [ ] **DB scale pass**: index audit under production-shaped data, connection pooling (Neon pooler/PgBouncer), query plans on the hot paths (positions read, SSE snapshot, analytics rollup reads).
- [x] **SSE fan-out across instances**: provider-neutral Redis pub/sub bridge, publisher echo suppression, tenant filtering, and per-client bounded mailboxes; real-Redis integration test in CI. See `docs/REALTIME_AND_COMMAND_ROUTING.md`.
- [ ] Web map performance: marker clustering ≥1k devices (shared with M6), trail simplification.
- **Exit:** the 10k-device load run passes the 300 ms p95 gate; two API instances serve the same tenant's live map concurrently.

#### M15 — Product completeness (UI/UX + mobile GA)
Goal: close every PARTIAL/TODO user-facing gap; this is the remaining M6/M7/M10 work plus the quality bar.
- [ ] **M6 remainder**: polygon drawing, geofence editing, marker clustering, trail playback scrubber, device-group views.
- [ ] **Operator admin console UI** on top of the token-gated `/admin` API (plans, versions, rates, margin check, period close).
- [ ] **M7 remainder**: developer portal polish (keys UX, embedded docs, webhook tester).
- [ ] **M10 mobile GA**: background tracking + offline queue/sync, in-app map, push deep-linking, EAS builds + mobile folded into turbo CI.
- [x] **Scheduled report PDF** format — `apps/jobs/src/report-pdf.ts` (pdf-lib, paginated A4 table, WinAnsi-safe names); the weekly job now writes/archives CSV + PDF side by side; 2 unit tests (valid PDF, pagination + exotic names).
- [ ] **WCAG 2.2 AA audit** + fixes on all screens; externalize UI strings for i18n (en/hi).
- [ ] **Playwright E2E suite** in CI: register → add device → simulate fixes → geofence alert → ack → report → upgrade plan (mock payment).
- **Exit:** the PRD §7 GA checklist is fully green.

### Phase 1.5 — Configurable plans & metered billing
Goal: plans/prices/limits are admin-configurable from the DB (not a code constant), with grandfathering, and per-use resources are billed at a configurable cost×markup so infra price changes flow to client pricing from one place. Defaults: 2.5× markup, soft-cap + overage billing.
- [x] **DB-backed versioned plan catalog** — `plans` + `plan_versions` tables (seeded from the built-in constant via migration 0011). The API resolves limits/prices from the DB through a cached `plan-service` (falls back to the constant if the catalog is empty), tenants **pin to a plan version** for grandfathering, and quotas, `/billing/plans`, checkout, upgrade and downgrade are all DB-driven. Gated tests cover catalog resolution + grandfathering.
- [x] **Billing rates + metered overages** — a `billing_rates` table (unit cost × markup, seeded sms/whatsapp/email, default 2.5×) resolved through a cached `billing-rates-service`; `usage_counters` extended with whatsapp/email and metered on dispatch; `computeOverages` bills `(used − included) × rate` soft-capped, surfaced in `getBilling`. Gated tests cover the rate math and over/under-quota overages.
- [x] **Admin CRUD** for plans/versions/rates — token-gated `/admin/*` API (`ADMIN_API_TOKEN`): create plans, edit price/limits via **versioning-on-edit** (archives the active version, adds a new one, so pinned subscribers stay grandfathered), upsert metered rates, and a **margin guardrail** (`/admin/margin-check` flags any plan priced below its included-unit cost). Retention's `historyDays` now resolves from the DB catalog (pinned version → current → constant fallback). Gated tests cover auth, create, version-on-edit, rate upsert, and the margin flag.
- [x] **Overages into invoicing** — `invoiceOverages` bills a period's metered overages as an idempotent `due` GST invoice; `POST /admin/billing/close/:period` bills every tenant for a closed period. The web billing screen now reads the **DB-driven plan catalog** (`/billing/plans`) instead of a hardcoded list and surfaces pending overage charges. (Operator admin *console UI* deferred — the token-gated `/admin` API is the surface for now. Web changes are typecheck-verified; browser check pending.)

---

## 5. Cross-cutting hardening backlog

Small, high-leverage fixes that don't belong to a single milestone:
- [x] Add the integration keys (Resend/MSG91/Razorpay/WhatsApp/Upstash/Sentry/ADMIN) to `.env.example`.
- [x] Security review pass: independent review of the new auth/billing/admin/ingest code confirmed tenant isolation, parameterized SQL, and constant-time compares; fixes applied — pin JWT alg to HS256, refuse to boot in production with dev-default secrets (`assertSecureConfig`), per-IP throttling on `/auth/*` + `/admin/*` (prod), tenant-scope the user delete, and bump `drizzle-orm` to 0.45.2 (high-severity identifier-SQLi advisory; our code never passes user input as identifiers). Remaining: `next` web advisories (DoS/SSRF) need a Next 15 upgrade + browser verification.
- [x] Idempotency on ingest + billing webhooks — ingest dedups retransmitted fixes via a unique `(device_id, fix_time)` index + `onConflictDoNothing` (a duplicate skips re-firing alerts and re-bumping device state); billing upgrades are already idempotent via the invoice `(provider, providerRef)` dedup. Gated test covers the ingest dedup.
- [x] CORS/`WEB_ORIGIN` and HTTPS enforcement: production CORS allows only `WEB_ORIGIN` (localhost is dev/test-only); HTTPS enforced at the edge (Fly `force_https` + Vercel).
- [x] Replace remaining dev tokens/secrets in non-local environments — enforced at boot: the API refuses to start in production while any JWT/ingest secret is still a dev default.

---

## 6. Quality bar & verification (carried forward)

- **UI:** every screen handles loading / empty / error / success; light + dark; responsive; AA contrast.
  Verify in a real browser (golden path + edge cases) before calling frontend work done.
- **Protocols:** byte-level fixtures per message type; CRC-failure and malformed-frame cases.
- **Tenant isolation:** RLS denial proven in CI.
- **End-to-end per milestone:** exercise the feature through the real pipeline (simulator → ingest →
  DB → SSE → UI; payment → webhook → invoice; alert → channel → delivery log), not just unit tests.
- **Load:** Artillery/`loadtest` at ~1,000 simulated devices; p95 < 500 ms target.

---

## 7. Related documents
- [README](../README.md) — architecture and quickstart.
- [docs/GETTING_STARTED.md](GETTING_STARTED.md) — end-user guide (workspace, devices, geofences, API).
- [DEPLOY.md](../DEPLOY.md) — go-live on the low-cost stack + go-live checklist.
- [docs/ROADMAP.md](ROADMAP.md) — the practical-use roadmap (Phases A–E), now shipped.
