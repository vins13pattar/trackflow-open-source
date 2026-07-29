# TrackFlow — Sub-processors

Third parties that may process customer data on TrackFlow's behalf, what they receive, and
why. Referenced by the [Privacy Policy](../apps/web/src/app/privacy/page.tsx) and available
to customers on request. Changes are announced at least 14 days before a new sub-processor
handles production data.

All integrations are **key-gated**: a sub-processor only ever receives data if the operator
configures its credentials. An unconfigured row simply isn't in the data path.

| Sub-processor | Purpose | Data shared | Region notes |
|---|---|---|---|
| **Configured PostgreSQL provider** | Primary database | All tenant data, encrypted at rest | India region required for the default real-data profile |
| **Fly.io** | API + ingest compute | Data in transit through the services | Region pinned (e.g. `bom` for India) |
| **Vercel** | Dashboard hosting | No tenant data at rest; serves the static app | Global CDN |
| **Cloudflare** | DNS, TLS, WAF, and custom domains (for SaaS) | Hostnames and request metadata | Global network |
| **Configured S3-compatible provider** | Reports, exports, and invoice archives | Generated tenant documents | India region required for the default real-data profile |
| **Configured Redis provider** | Rate limits, session routing, and presence | Counter keys (tenant/user/key ids), IMEI-to-instance mapping | India region required for the default real-data profile |
| **Resend** | Transactional email (invites, resets, reports) | Recipient email, message content | — |
| **MSG91** | SMS alerts (India, DLT-registered) | Recipient phone, message content | India |
| **Meta (WhatsApp Cloud API)** | WhatsApp alerts | Recipient phone, message content | — |
| **Expo (EAS)** | Mobile push delivery | Push tokens, notification content | — |
| **Razorpay** | Payments (India) | Payment/order refs, amount, plan. Card/UPI data never touches TrackFlow | India |
| **Stripe** | Payments (international) | Checkout session refs, amount, plan. Card data never touches TrackFlow | — |
| **Sentry** | Error tracking (DSN-gated) | Error messages, stack traces, request/tenant ids — no position payloads | — |

**Not sub-processors:** map tiles (OpenFreeMap/MapTiler) are fetched by the user's browser
directly with no TrackFlow-held personal data attached; the operator can self-host tiles.
