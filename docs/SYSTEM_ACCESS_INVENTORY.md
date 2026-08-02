# Privileged system access inventory

TrackFlow uses two PostgreSQL runtime identities:

- `trackflow_app` (`DATABASE_URL`) is the tenant request identity. It is
  `NOSUPERUSER NOBYPASSRLS` and cannot create schema objects. A caller supplies
  a valid tenant UUID through `withTenant`; PostgreSQL RLS remains the final
  isolation boundary.
- `trackflow_system` (`SYSTEM_DATABASE_URL`) is a separate, narrowly distributed
  `BYPASSRLS` identity for reviewed cross-tenant operations. Calls must use
  `withSystem` with an approved reason. The helper rejects the tenant identity
  and tags the transaction `application_name` with its reason.

The API process needs both identities because authentication and provider
callbacks sometimes run before a tenant-scoped transaction can be established.
Holding both URLs in one process does not protect against total process
compromise, but it prevents a query on the tenant pool from promoting itself by
setting a custom PostgreSQL GUC. Jobs receive only the system URL.

## Reviewed production call sites

| Reason | Call site | Why tenant RLS cannot be used | Required constraint |
| --- | --- | --- | --- |
| `api-key-authentication` | `apps/api/src/middleware/auth.ts` | The tenant is discovered from a hashed API-key lookup. | Compare the token hash and return only the matched key's tenant and scopes. |
| `sso-bootstrap` | `apps/api/src/routes/saml.ts` | Public SAML bootstrap resolves a tenant from its unique slug before authentication. | Validate SAML signatures and issuer/audience; repeat the resolved tenant predicate on every query. |
| `sso-bootstrap` | `apps/api/src/routes/scim.ts` | SCIM bearer authentication resolves the tenant from an API key. | Require the `scim:provision` scope and predicate writes by the authenticated tenant. |
| `device-command-routing` | `apps/api/src/routes/positions.ts` | Ingest admission, command polling, and ACK handling originate from devices rather than tenant JWTs. | Require the ingest token, admitted identity, device identifier, and idempotent command state transition. |
| `notification-delivery` | `apps/api/src/alert-dispatch.ts` | A background event fans out to tenant-configured channels. | Carry the originating tenant ID and repeat it in device, geofence, token, and alert predicates. |
| `notification-delivery` | `apps/api/src/template-service.ts` | Delivery workers resolve templates without a user request. | Predicate active templates by the event tenant and use locale fallback only inside that tenant. |
| `notification-delivery` | `apps/api/src/dispatch-rules.ts` | Delivery policy is evaluated asynchronously. | Predicate settings and routes by the event tenant; rate-limit keys include the tenant. |
| `notification-delivery` | `apps/api/src/delivery-log.ts` | Provider outcomes are appended after the request transaction. | Rows inherit the already-resolved tenant and alert identifiers. |
| `notification-delivery` | `apps/api/src/webhook-service.ts` | Retry workers enumerate pending deliveries across tenants. | Re-resolve each webhook's tenant, validate the target, sign payloads, and update by delivery ID. |
| `device-status` | `apps/api/src/device-events.ts` | Offline detection scans all admitted devices. | Preserve the device row's tenant ID through alert and webhook emission. |
| `billing-provider` | `apps/api/src/billing-service.ts` | Signed provider callbacks and scheduled invoice generation are cross-tenant. | Verify provider signatures, use provider IDs as idempotency keys, and predicate tenant updates explicitly. |
| `audit-write` | `apps/api/src/audit-log.ts` | Audit writes must survive independently of the tenant route transaction. | Accept tenant and actor context only from authenticated middleware and never expose cross-tenant reads. |
| `system-job` | `apps/jobs/src/rollup.ts` | The scheduler computes all fleets' trips. | Derive tenant IDs from device rows and write every trip with that same tenant. |
| `system-job` | `apps/jobs/src/daily-rollup.ts` | The scheduler aggregates all tenants' completed trips. | Group and persist by tenant/device/day without accepting request context. |
| `system-job` | `apps/jobs/src/ingest-health.ts` | The scheduler evaluates stale ingest across all devices. | Update only the device IDs returned by the bounded stale-device query. |
| `system-job` | `apps/jobs/src/notify-retry.ts` | Retries enumerate due delivery rows across tenants. | Claim rows idempotently, preserve tenant IDs, and bound attempts/backoff. |
| `system-job` | `apps/jobs/src/report.ts` | Scheduled reports enumerate fleets across tenants. | Build each report from the device row's tenant and keep generated object keys tenant-scoped. |
| `system-job` | `apps/jobs/src/retention.ts` | Retention and partition jobs apply global policy. | Read approved plan retention, delete with explicit tenant predicates, and use only granted maintenance functions. |

`packages/db/src/system-access-inventory.test.ts` fails CI when a production
`withSystem` caller uses an unknown reason, uses the test capability, or is not
listed here. `packages/db/src/rls.test.ts` proves that the tenant identity cannot
self-assert the historical `app.bypass_rls` GUC, invoke `withSystem`, create a
table, or access another tenant.

## Surface verification map

| Surface | Repository evidence |
| --- | --- |
| REST tenant resources, reports, alerts, billing, exports | API route and service tests under `apps/api/src/*.test.ts`, including analytics, privacy export/deletion, billing, alert delivery, and device commands |
| GraphQL | `apps/api/src/graphql.test.ts` covers unauthenticated access, tenant scoping, and cross-tenant identifiers |
| SSE | `apps/api/src/device-commands.test.ts` and realtime tests cover authenticated tenant/device routing; shared broker and slow-consumer work remains tracked in #19 |
| Admin | `apps/api/src/admin.test.ts` covers operator-token and tenant-role separation |
| SCIM and SAML | `apps/api/src/scim.test.ts` and `apps/api/src/saml.test.ts` cover credential, scope, signature, and tenant behavior |
| Jobs and background tasks | Tests under `apps/jobs/src/*.test.ts` cover rollups, subscriptions, ingest health, and notification retries |
| Database isolation | `packages/db/src/rls.test.ts` covers read/write/join isolation, malformed context, role attributes, schema mutation, and noisy-neighbour concurrency |

This inventory is code-review evidence, not production credential-rotation or
live multi-replica evidence. Those gates remain open separately.
