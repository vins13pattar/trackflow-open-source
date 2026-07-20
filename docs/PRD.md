# TrackFlow — Product Requirements Document (PRD)

| | |
|---|---|
| **Version** | 2.0 |
| **Status** | Active — supersedes the original PRD |
| **Date** | 2026-06-12 |
| **Plan of record** | [PROJECT_PLAN.md](PROJECT_PLAN.md) (build status + roadmap with checkboxes) |
| **Companion docs** | [README](../README.md) (architecture) · [DEPLOY.md](../DEPLOY.md) (go-live) · [GETTING_STARTED.md](GETTING_STARTED.md) (user guide) |

This v2 PRD reconciles the original requirements with what is actually built (audited in
PROJECT_PLAN §3) and raises the bar to **enterprise-grade**: explicit SLOs, security/compliance
targets, accessibility, and release criteria that meet or exceed what established fleet-tracking
vendors (Samsara, Geotab, LocoNav, Fleetx) publish — at a fraction of their run cost.

---

## 1. Vision & problem

Fleet operators in India and emerging markets pay ₹300–600/vehicle/month for tracking platforms
that are closed, hard to white-label, and expensive to integrate. Open-source alternatives
(Traccar) are single-tenant-minded and operationally heavy.

**TrackFlow** is a multi-tenant GPS-tracking SaaS with in-house protocol decoders, true
database-enforced tenant isolation (Postgres RLS), self-serve billing, and a white-label +
API-first surface — on a hybrid-serverless stack that costs ~₹0 at idle and scales horizontally.

**One-line:** *Enterprise-grade fleet tracking that a two-person company can operate and a
1,000-vehicle enterprise can trust.*

## 2. Goals & non-goals

### Goals (GA)
1. **Track anything**: the ~90% of the India device market (GT06/GT06N, H02, Teltonika 8/8E,
   Queclink, Meitrack, NMEA, MQTT) decodes in-house with byte-level tests; phones via the mobile app.
2. **Safe with paying customers**: real payments (Razorpay + Stripe), GST invoices, quotas,
   metered overages, grandfathered plan versions.
3. **Enterprise-ready**: SSO/SAML, SCIM, custom domains + TLS, audit logs, RBAC, multi-org,
   white-label branding — already shipped; certified-grade security posture is the remaining gap.
4. **Operable by a tiny team**: SLO-backed observability, automated retention/backups/restore
   drills, runbooks, near-zero idle cost.
5. **API-first**: every UI capability available via documented REST (+ read-only GraphQL),
   scoped API keys, signed webhooks with delivery logs.

### Non-goals (this horizon)
- Video telematics / dashcam ingest (roadmap candidate, see §10).
- Hardware manufacturing or SIM/data-plan reselling.
- Driver payroll/expense modules; full TMS/logistics planning.
- On-premise installs (data-residency is solved by region pinning, not on-prem).

## 3. Personas

| Persona | Needs |
|---|---|
| **Fleet manager** (10–500 vehicles) | Live map, geofences, alerts (WhatsApp/SMS first), trip history, driver scores, simple reports. |
| **Owner-operator / SMB** (1–10 vehicles) | Cheap, self-serve signup, phone-as-tracker, UPI/card payment, Hindi UI. |
| **Reseller / white-label partner** | Own domain + branding, per-tenant pricing, operator admin API, margin visibility. |
| **Enterprise IT admin** | SAML SSO, SCIM provisioning, audit logs, data-residency (India), security questionnaire answers (SOC 2 / ISO 27001 alignment). |
| **Integrator / developer** | OpenAPI docs, API keys, webhooks with retries + delivery logs, GraphQL reads, sandbox. |
| **Platform operator (us)** | Plan/rate catalog admin, usage metering, margin guardrails, SLO dashboards, on-call runbooks. |

## 4. Competitive positioning

| | TrackFlow | Traccar (OSS) | LocoNav / Fleetx | Samsara / Geotab |
|---|---|---|---|---|
| Multi-tenant SaaS w/ DB-enforced isolation | ✅ RLS | ❌ | ✅ (opaque) | ✅ (opaque) |
| White-label + custom domain + TLS automation | ✅ | ❌ | Partial | ❌ |
| Self-serve billing (UPI + intl cards, GST) | ✅ | ❌ | Sales-led | Sales-led |
| Open protocol decoders w/ byte-level tests | ✅ | ✅ | ❌ | ❌ |
| SSO/SAML + SCIM + audit logs | ✅ | ❌ | Enterprise tier | ✅ |
| Idle cost | ~₹0 | self-hosted | n/a | n/a |

**Differentiator to defend:** the combination of *verifiable* tenant isolation (RLS, tested in CI),
white-label automation, and metered configurable pricing — none of the incumbents offer all three.

## 5. Functional requirements

Priorities: **P0** = required for GA · **P1** = fast-follow · **P2** = differentiator.
Status: ✅ shipped · 🟡 partial · ⬜ planned. (Detail per item lives in PROJECT_PLAN §3–4.)

### 5.1 Tracking core
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-TRK-1 | Decode GT06/H02/Teltonika 8/8E+12/NMEA/Queclink/Meitrack with CRC + ACK, byte-level tests | P0 | ✅ |
| FR-TRK-2 | Multi-port TCP ingest, per-socket sessions, IMEI binding, retransmit dedup | P0 | ✅ |
| FR-TRK-3 | MQTT ingest (`trackflow/<protocol>/<imei>/up`) | P1 | ✅ |
| FR-TRK-4 | Live map (SSE) with heading markers, trail, telemetry panel; history replay | P0 | ✅ |
| FR-TRK-5 | Telemetry normalization (ignition, voltages, fuel, temp, OBD-II PIDs) | P0 | ✅ |
| FR-TRK-6 | Two-way commands (immobilize, locate, set-interval) with state machine + audit | P1 | 🟡 backend done; per-protocol wire delivery for GT06 pending |
| FR-TRK-7 | Marker clustering ≥1k devices; trail playback scrubber | P1 | ⬜ |

### 5.2 Devices, vehicles & geofencing
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-DEV-1 | Device CRUD, active/inactive, live/offline from `lastSeen`, connection guide | P0 | ✅ |
| FR-DEV-2 | Vehicles with multiple devices; aggregated telemetry | P0 | ✅ |
| FR-DEV-3 | Device groups + group-targeted geofences | P1 | 🟡 backend done; UI views pending |
| FR-GEO-1 | Circle + polygon + dwell engine with entry/exit throttling | P0 | ✅ |
| FR-GEO-2 | Polygon drawing + geofence editing in UI | P0 | ⬜ (engine ready; UI is circle-only) |

### 5.3 Alerts & notifications
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-ALR-1 | Alert feed (SSE), severity, acknowledge | P0 | ✅ |
| FR-ALR-2 | Email/SMS/WhatsApp/Push/Webhook channels, key-gated | P0 | ✅ |
| FR-ALR-3 | Per-tenant templates (en/hi), quiet hours (TZ-aware), throttling, routing rules | P1 | ✅ |
| FR-ALR-4 | Delivery log + automatic retries w/ backoff; status in UI | P1 | ✅ (UI table needs browser pass) |
| FR-ALR-5 | WhatsApp template messages (outside 24h window) | P1 | ⬜ |

### 5.4 Trips, analytics & reports
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-ANL-1 | Trip detection, driver score, daily rollups, dashboards | P0 | ✅ |
| FR-ANL-2 | CSV export; scheduled emailed reports archived to R2 | P0 | ✅ |
| FR-ANL-3 | PDF report format | P1 | ⬜ |
| FR-ANL-4 | Predictive insights (idle-cost, fuel-anomaly, maintenance-due heuristics) | P2 | ⬜ |

### 5.5 Billing & plans
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-BIL-1 | Razorpay (India) + Stripe (intl), webhook-verified, idempotent upgrades | P0 | ✅ |
| FR-BIL-2 | GST PDF invoices, archived + pre-signed download | P0 | ✅ |
| FR-BIL-3 | Quotas, 14-day trial, downgrade guardrails, cancel-at-period-end | P0 | ✅ |
| FR-BIL-4 | DB-backed versioned plan catalog w/ grandfathering; metered rates (cost × markup); overage invoicing | P0 | ✅ |
| FR-BIL-5 | Proration / refunds on plan change | P1 | ⬜ |
| FR-BIL-6 | Operator admin **console UI** over the `/admin` API | P1 | ⬜ (API shipped) |

### 5.6 Identity, tenancy & enterprise
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-IDN-1 | Postgres RLS isolation (FORCE, non-superuser runtime role, CI-proven) | P0 | ✅ |
| FR-IDN-2 | JWT access+refresh w/ rotation, reuse detection, sessions UI, logout-all | P0 | ✅ |
| FR-IDN-3 | RBAC (owner/admin/manager/user/viewer), invites w/ email, audit logs | P0 | ✅ |
| FR-IDN-4 | Password reset, email verification, strength rules | P0 | ✅ |
| FR-IDN-5 | **MFA (TOTP) + recovery codes; per-tenant MFA enforcement** | P0 | ⬜ |
| FR-IDN-6 | SAML SSO (per-tenant, JIT provisioning); SCIM 2.0 | P1 | ✅ |
| FR-IDN-7 | Multi-org membership + org switching | P1 | ✅ |
| FR-IDN-8 | White-label branding + custom domains (Cloudflare for SaaS TLS) | P1 | ✅ |

### 5.7 Public API & integrations
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-API-1 | Scoped, hashed API keys; rate limits (shared store, multi-instance) | P0 | ✅ |
| FR-API-2 | Full OpenAPI spec + `/docs`; integrity-tested | P0 | ✅ |
| FR-API-3 | Signed webhooks, retries, delivery log, per-event/device filters | P0 | ✅ |
| FR-API-4 | Read-only GraphQL | P2 | ✅ |
| FR-API-5 | Developer portal polish (keys, docs, webhook tester) | P1 | ⬜ |

### 5.8 Mobile
| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-MOB-1 | Sign-in, device list, foreground GPS reporting, push registration | P0 | ✅ |
| FR-MOB-2 | Background tracking + offline queue/sync | P0 (mobile GA) | ⬜ |
| FR-MOB-3 | In-app map; push deep-linking | P1 | ⬜ |
| FR-MOB-4 | EAS builds (TestFlight/Play) in CI | P1 | ⬜ |

## 6. Non-functional requirements

These targets are the "exceed industry standards" bar. Each must be **measured** (dashboards)
and most are **enforced** (CI gates, alerts) — not aspirational prose.

### 6.1 Performance & scale
| Metric | Target | Industry typical | Enforcement |
|---|---|---|---|
| API p95 latency (authenticated reads) | **< 300 ms** | < 500 ms | load-test CI gate (`P95_BUDGET_MS`) — shipped |
| Device fix → live map (SSE) p95 | **< 2 s** | 5–30 s | synthetic probe (planned M13) |
| Ingest decode throughput | ≥ 5k fixes/s/instance | n/a | loadtest harness |
| Scale design point | **50k devices / 10k open sockets**, 1B+ positions | 10–25k | partitioning (shipped) + multi-instance ingest (M12) |
| Web LCP (dashboard, p75) | < 2.5 s | < 2.5 s | Lighthouse CI (planned) |

### 6.2 Availability & disaster recovery
| Metric | Target | Notes |
|---|---|---|
| API/web availability | **99.95%/mo** | error budget ≈ 21 min/mo; burn-rate alerts |
| Ingest availability | **99.9%/mo** | requires multi-instance ingest (M12); watchdog alert shipped |
| RPO | **≤ 5 min** | Neon PITR |
| RTO | **≤ 60 min** | runbook + `db:verify-restore` (shipped); drill automation in M12 |
| Restore drill | **Quarterly, automated** | scripted PITR branch + verifier in scheduled CI |
| Deploys | Zero-downtime (blue/green), health+readiness probes | M12 |
| Status page | Public, with component-level uptime | M12 |

### 6.3 Security
Target posture: **OWASP ASVS Level 2** verified; **SOC 2 Type II readiness** at GA (audit
window starts at GA); ISO 27001-aligned policies.

- **Shipped:** RLS tenant isolation (CI-proven), HS256-pinned JWT, PBKDF2, refresh rotation +
  reuse detection, constant-time compares, parameterized SQL, secret-default boot refusal,
  per-IP auth throttling, signed webhooks, hashed API keys, append-only audit logs, prod CORS
  allow-list, HTTPS at edge.
- **Required for GA (M11):** MFA/TOTP + recovery codes; CSP/HSTS + security headers; CI security
  gates (dependency audit, secret scanning, SAST, SBOM); Next.js 15 upgrade (clears known
  advisories); external penetration test with criticals/highs fixed; vulnerability-disclosure
  policy + security.txt; secrets rotation runbook.
- **Standing:** 90-day key-rotation capability; least-privilege DB roles; no secrets in git
  (platform secret stores only).

### 6.4 Privacy & compliance
| Requirement | Target |
|---|---|
| India **DPDP Act 2023** | Consent notices for driver tracking; data-principal rights: export + verified hard-delete (DSR endpoints, M11); breach-notification runbook |
| **GDPR** (intl tenants) | Same DSR machinery; DPA template; sub-processor list |
| **GST** | Tax invoices with CGST/SGST split — shipped |
| **AIS-140** (India commercial mandate) | Decode AIS-140-compliant devices (GT06-family largely covers); document compliance posture for RFPs |
| Data residency | India region pinning (Mumbai) available for enterprise — documented in DEPLOY.md |
| Retention | Per-plan position retention (7/90/365/∞) enforced by job — shipped |

### 6.5 Accessibility, i18n & quality
- **WCAG 2.2 AA** on all dashboard screens (audit + fixes in M15); AA contrast in light/dark — partially shipped.
- i18n: en + hi notification templates shipped; UI string externalization planned (M15).
- Every screen handles loading/empty/error/success states (quality bar carried from PROJECT_PLAN §6).
- Test pyramid: byte-level protocol fixtures, unit, RLS-isolation in CI, gated DB integration,
  load-test p95 gate (all shipped) + Playwright E2E golden-path suite in CI (M15).

### 6.6 Cost & FinOps — pay only for what is used

A **hard product requirement**, not an aspiration: every component must be usage-billed
(scale-to-zero) or justified as the cheapest always-on primitive available. Idle cost of a
fully-deployed production stack must stay near zero.

| Component | Billing model | Idle cost target |
|---|---|---|
| API (Hono) | Scale-to-zero container (Fly autostop / Cloud Run min-instances=0) or Workers per-request | ₹0 |
| Web (Next.js) | Vercel/Pages — per-request | ₹0 |
| Postgres | Neon serverless — scales to zero, billed per compute-second + storage | ₹0 compute at idle |
| Jobs | Cron-invoked (Fly Machines / Cloud Run Jobs / GH Actions) — billed per run | ₹0 between runs |
| Object storage | R2 — per GB, zero egress | ~₹0 |
| Redis / rate-limit | Upstash — per-command | ₹0 at idle |
| Email/SMS/WhatsApp/Push | Per-message, key-gated | ₹0 |
| **Ingest (TCP)** | The one always-on piece (devices hold open sockets): smallest viable instance | **≤ ₹500/mo total** |

Standing rules:
- **Idle floor ≤ ₹500/mo** (the single smallest ingest instance); **~1,000 devices ≤ ₹4k/mo**.
  Cost per 1k devices is tracked as a KPI and must fall as the fleet grows.
- New infrastructure must default to a usage-billed option; an always-on component requires an
  explicit justification in PROJECT_PLAN (today: only ingest qualifies).
- Scale-out (M12/M14) must preserve this: extra ingest/API instances spin up under load and
  scale back; autoscaling floors stay at the minimum (1 ingest, 0 API).
- MQTT-over-serverless ingest is the long-term path to removing even the ingest floor for
  MQTT-capable devices (decoders already support it).
- Metered customer billing (cost × markup, margin guardrail — shipped) keeps every variable
  infra cost passed through to revenue from one admin surface.

### 6.7 Observability & operations
- Structured request logs w/ request-id + tenant context — shipped (API).
- Sentry: API shipped; **ingest + web** pending (M13).
- **OpenTelemetry traces** (web→API→DB), Prometheus metrics + Grafana SLO dashboards,
  burn-rate alerts, log aggregation w/ retention — M13.
- Ingest-liveness watchdog with critical alert — shipped.
- On-call runbooks per failure mode; incident severity matrix — M12.

## 7. Release criteria (GA definition)

GA is declared when **all** of the following hold:

1. All P0 functional requirements ✅ (open today: FR-GEO-2 polygon UI, FR-IDN-5 MFA, FR-MOB-2 background tracking).
2. NFR gates green: p95 < 300 ms in CI load test at 1k devices; RLS isolation test green; restore drill executed and verified once.
3. Security: external pen test complete, criticals/highs remediated; MFA available; CI security gates on; Next 15 shipped.
4. Multi-instance ingest deployed (kill-one-pod test passes with reconnect + no data loss).
5. Real-money loop verified in production: live Razorpay payment → webhook → plan upgrade → GST PDF.
6. Status page live; on-call rota + runbooks exist; Sentry on all three surfaces.
7. WCAG 2.2 AA audit pass on the golden path; Playwright E2E suite green in CI.
8. Docs complete: API `/docs`, getting-started, DPA/privacy/ToS, security whitepaper (1-pager).

## 8. Success metrics (first 2 quarters post-GA)

| Metric | Target |
|---|---|
| Activation (signup → first live device < 24h) | ≥ 40% |
| Time-to-first-fix (median, signup → first position) | < 30 min |
| Uptime vs SLO | No month breaches error budget |
| Paid conversion (trial → paid) | ≥ 8% |
| Net revenue retention | ≥ 100% |
| Support load | < 0.5 tickets/tenant/month |
| Gross margin per tenant | ≥ 70% (margin guardrail enforced in plan admin — shipped) |

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Single-instance ingest is a SPOF for the always-on path | M12 multi-instance (NLB + Redis IMEI session map); watchdog alert already fires on staleness |
| Device protocol variants in the wild differ from fixtures | Capture-replay tooling; unknown-frame logging; per-protocol raw-IO escape hatch (shipped for Teltonika) |
| Payment/webhook edge cases with real money | Idempotent upgrades keyed on provider ref (shipped); live test-mode verification before GA (release criterion 5) |
| SMS DLT (TRAI) approval delays in India | WhatsApp + email channels shipped as primary; SMS key-gated |
| Compliance burden (DPDP/SOC 2) for a small team | Scope SOC 2 to readiness at GA; automate evidence collection; policies from templates |
| Cost creep breaks the low-cost positioning | §6.6 FinOps rules: usage-billed by default, idle floor ≤ ₹500/mo, metered rates with cost × markup + margin guardrail (shipped); idle-cost budget alarms |

## 10. Roadmap beyond GA (P2 candidates)

Fuel-theft detection, maintenance scheduling, route optimization, driver-behavior ML scoring,
video telematics ingest, marketplace of per-region resellers, Workers-edge API deployment.
Each enters via PROJECT_PLAN with its own milestone before any commitment.

---

*Change log: v2.0 (2026-06-12) — full rewrite: reconciled with codebase audit, added NFR/SLO
targets, security & DPDP/SOC 2 compliance bar, GA release criteria, KPIs. v1.x — original PRD
(superseded; capability scope folded into PROJECT_PLAN §3).*
