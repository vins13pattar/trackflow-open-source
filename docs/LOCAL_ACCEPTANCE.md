# Local product acceptance

Last executed: 2026-08-02. All identities, IMEIs, and records used in this
exercise were synthetic and remained in the local Docker PostgreSQL instance.
No ingest listener or hosted environment was started.

## Executed browser journey

The Codex in-app Chromium browser exercised a locally running Next.js web app
and Hono API backed by the repository's PostgreSQL and Redis containers.

| Check | Result | Evidence boundary |
|---|---|---|
| Register a new tenant and owner | Pass | Synthetic local tenant; redirected to the authenticated dashboard |
| Render the live-map dashboard | Pass | Correct tenant/owner identity, empty-fleet state, map, and onboarding controls rendered |
| Create a GT06 device | Pass | Synthetic 15-digit IMEI and registration were persisted and reloaded through the authenticated API |
| Open the tracker connection guide | Pass | Correct host, protocol port, IMEI, and example SMS commands rendered; ingest stayed stopped |
| Desktop layout | Pass | Dashboard and device management rendered without an error overlay or browser console warning/error |
| Mobile layout at 390 x 844 | Pass after fix | Device data uses a stacked card; no IMEI/protocol/action overlap |
| Mobile navigation | Pass after fix | Drawer exposes dialog semantics, a labelled backdrop, and an explicit close control; open/close was exercised |
| Production build | Pass | `pnpm --filter @trackflow/web build` |
| Web typecheck and tests | Pass | `pnpm --filter @trackflow/web typecheck` and 5 Vitest checks |

Browser screenshots were inspected during the run but are intentionally not
versioned as release evidence.

## Automated browser gate

The manual flow is now covered by `pnpm test:e2e:local`. Playwright runs the
same synthetic signup, dashboard, device-registration, connection-guide, and
workspace-cleanup journey in light-theme desktop Chromium and a dark-theme
390 x 844 mobile profile. It also fails on browser errors or serious/critical
axe accessibility findings.

The gate builds and starts the web app with its same-origin API proxy, starts
the API, expects local PostgreSQL and Redis, and never starts the ingest
listener or simulator. CI installs Chromium and runs this suite after the
repository build. Failed-run screenshots, traces, and video stay untracked
under `test-results/`; successful runs leave no tenant or tracker rows behind.

The first automated run found dark-theme primary text/button contrast below
WCAG AA and a connection guide without dialog semantics. Both were corrected
before recording the passing desktop and mobile result.

## Supported-client matrix

This matrix distinguishes repository/local evidence from external acceptance.

| Client or integration | Repository/local status | Required external evidence |
|---|---|---|
| Chromium desktop | Automated browser and axe journey passes locally and in CI | Repeat against the release candidate and hosted CSP/TLS headers |
| Chromium responsive viewport | Automated 390 x 844 browser and axe journey passes locally and in CI | Physical Android Chrome coverage |
| Safari desktop and iOS Safari | Not executed | Current Safari plus supported iOS physical devices |
| Firefox desktop | Not executed | Current Firefox release |
| Android native app | Jest suite passes in CI | Physical background location, offline sync, deep links, push, battery, and map rendering |
| iOS native app | Shared Jest suite passes in CI | Physical background location, offline sync, deep links, push, battery, and map rendering |
| Resend, MSG91, Expo push | Mocked/contract paths only | Provider sandbox negative, retry, redaction, and replay acceptance |
| Razorpay and Stripe | Local/test-mode code paths only | Provider test accounts, signed webhook replay, invoice, and refund acceptance |
| SAML SSO and outbound webhooks | Unit/integration coverage only | Real IdP/provider signature, rotation, negative, and replay acceptance |

Issue #20 remains open because physical-device, cross-browser, hosted CSP/TLS,
and external-provider evidence cannot be inferred from this local run.
