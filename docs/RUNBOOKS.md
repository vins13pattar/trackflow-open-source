# TrackFlow — Operational Runbooks

Per-failure-mode procedures for whoever is on call. Keep each runbook current as the
infrastructure evolves; every incident postmortem should end with a PR against this file.

**Severity matrix**

| Sev | Definition | Examples | Response |
|---|---|---|---|
| **SEV-1** | Data loss in progress or full outage | Ingest down (devices buffering/dropping), DB unreachable, auth broken for all tenants | Drop everything; status page + customer comms within 30 min |
| **SEV-2** | Degraded core path | SSE lag > 1 min, webhook/notification delivery failing, payments webhook down | Fix within hours; status page if customer-visible |
| **SEV-3** | Non-core degradation | Reports late, one notification channel down, dashboard cosmetic | Next business day |

General first moves for any page: check the status of the hosting providers (Fly, Neon,
Vercel, Upstash, Cloudflare), then `/health` on the API, then the freshest `devices.last_seen`
(the ingest-liveness signal the watchdog uses).

---

## RB-1 · Ingest down (SEV-1)

**Signal:** `ingest.downtime` critical alert (watchdog fires when the freshest `last_seen`
across the fleet goes stale while active devices exist), TCP probes failing, devices all "offline".

1. `fly status -a <ingest-app>` — is the machine running? Restart: `fly machine restart`.
2. Check ingest logs for a crash loop (`fly logs -a <ingest-app>`). A decoder crash on a
   malformed frame is caught and reported to Sentry (`decode:<protocol>` context) without
   killing the listener — if you see repeated `uncaughtException` instead, capture the
   payload bytes from the log and open a protocols bug; roll back the last ingest deploy.
3. If the machine is healthy but devices aren't connecting: verify DNS for the ingest host
   and that the TCP ports (5023/5013/5027/5004/5073/5020) are exposed in `fly.ingest.toml`.
4. If ingest runs but the API rejects forwards (`sink rejected message (401)` in logs):
   `INGEST_SINK_TOKEN` mismatch between ingest and API — re-sync the secret on both apps.
5. **Recovery check:** simulator round-trip — `pnpm --filter @trackflow/ingest sim gt06 <imei>`
   against production must appear on the live map within seconds.

**Data note:** most GPS devices buffer fixes on-board and replay on reconnect; ingest dedups
retransmissions via the `(device_id, fix_time)` unique index, so a short outage usually
back-fills itself. Mention this in customer comms.

## RB-2 · Database incident / failover & restore (SEV-1)

**Signal:** API 500s with DB connection errors; Neon status page incident.

1. Confirm scope on the Neon dashboard (compute restart vs. regional incident).
2. Compute restarts self-heal in seconds (serverless); the API reconnects. Verify `/health`.
3. **Point-in-time restore** (data corruption / bad migration):
   - Create a Neon branch at the last-known-good timestamp (Neon console → Branches → PITR).
   - Run the verifier against the branch: `DATABASE_URL=<branch-url> pnpm --filter @trackflow/db db:verify-restore`
     — it asserts migrations at HEAD, core tables, RLS enabled, partitioning intact.
   - Repoint `DATABASE_URL`/`ADMIN_DATABASE_URL` secrets at the branch; restart API/jobs.
   - **RPO target ≤ 5 min, RTO target ≤ 60 min.** Record actuals in the postmortem.
4. After stabilizing: run the RLS isolation test against production-shaped data
   (`TF_DB_TESTS=1 pnpm --filter @trackflow/db test`) before declaring all-clear.

## RB-3 · Webhook storm / delivery backlog (SEV-2)

**Signal:** `webhook_deliveries` failure rate spikes; a tenant's endpoint is down causing
retry amplification; outbound egress saturated.

1. Identify the noisy webhook: failures by webhook id in `webhook_deliveries`.
2. Pause it: `PATCH /webhooks/:id {"status":"paused"}` (tenant-visible, reversible, audited).
3. Deliveries already retry with backoff and cap at 3 attempts — a storm self-limits; the
   pause is to protect egress and the receiving endpoint.
4. If many tenants are affected (our egress problem, not theirs), check the API host's
   outbound networking before blaming endpoints.
5. Unpause after the endpoint recovers; failed events are visible in the delivery log
   (tenants can replay via the test endpoint).

## RB-4 · Payment webhook outage (SEV-2)

**Signal:** payments succeed at Razorpay/Stripe but plans don't upgrade; provider dashboard
shows webhook delivery failures.

1. Check provider webhook logs (Razorpay Dashboard → Webhooks; Stripe → Developers → Events).
2. Verify the endpoint URLs and that `RAZORPAY_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET`
   match (a secret rotation on one side silently 401s).
3. **Both providers retry failed webhooks for ~24h** and upgrades are idempotent (keyed on
   provider payment ref), so recovery is usually automatic once the endpoint is fixed —
   provider redelivery is safe to trigger manually too.
4. For a customer stuck mid-upgrade: confirm the payment in the provider dashboard, then
   replay the specific event from the provider console. Never hand-edit `tenants.plan`.

## RB-5 · Notification channel down (SEV-3)

**Signal:** `alert_deliveries` rows stuck in `failed`/retrying for one channel.

1. Check the provider (Resend / MSG91 / Meta WhatsApp / Expo) status and key validity.
2. The `notify-retry` job re-dispatches with exponential backoff until the attempt cap;
   nothing to do for transient provider blips.
3. If a key was rotated/revoked: update the platform secret; the next retry tick picks it up.
4. Critical alerts bypass quiet hours but not a dead channel — check tenants with
   `criticalBypass` expectations and consider a manual heads-up for anything safety-relevant.

## RB-6 · Data breach / suspected unauthorized access (SEV-1)

DPDP Act 2023 + GDPR both require prompt notification (GDPR: supervisory authority within
72h of becoming aware; DPDP: the Data Protection Board + affected data principals as
prescribed). Speed of assessment matters more than certainty.

1. **Contain:** revoke the suspected credential surface —
   - platform secrets: rotate JWT secrets (kills all access tokens at next verification),
     `INGEST_SINK_TOKEN`, `ADMIN_API_TOKEN`, provider keys as applicable;
   - per-tenant: revoke API keys (`api_keys.revoked_at`), force re-login via
     `sessions` revocation.
2. **Assess:** what data classes were reachable (positions? PII? invoices?), which tenants,
   what time window. `audit_logs` + request logs (request-id, tenant, principal) are the
   primary evidence — preserve them before any retention job runs.
3. **Notify:** affected tenants with facts (window, data classes, actions taken); the
   DPB/supervisory authority per counsel. Template the comms from this runbook's postmortem.
4. **Eradicate & recover:** patch the vector, verify with the security CI gates + a focused
   pen retest of the vector class.
5. **Postmortem:** blameless, written, with actions PR'd into this file and the PRD's
   security requirements where relevant.

## RB-7 · Deploy rollback

- **API/ingest (Fly):** `fly releases -a <app>` → `fly deploy --image <previous-image>`;
  machines roll with health checks (zero-downtime once blue/green lands in M12).
- **Web (Vercel):** promote the previous deployment from the Vercel dashboard (instant).
- **Migrations:** forward-only. Never roll back a migration in place — restore via RB-2
  PITR if a migration corrupted data, and ship a corrective forward migration otherwise.
