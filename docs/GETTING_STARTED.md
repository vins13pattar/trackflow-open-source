# TrackFlow — Getting Started

A complete guide to going live with TrackFlow: create your workspace, add devices
(real or simulated), and use tracking, geofences, alerts, reports, the API, and
white-label branding.

---

## 1. Create your workspace

1. Open the dashboard and click **Create an account**.
2. Enter your name, **company name** (this becomes your organization/tenant),
   email, and a password (min 8 characters).
3. You land on the **Live Map** as the workspace **owner**.

Each company is fully isolated from every other — enforced at the database with
row-level security.

---

## 2. Add a device

**Devices → Add device.** Fill in:

| Field | What it is |
|---|---|
| **Name** | A label, e.g. the number plate `KA-01-AB-1234` |
| **IMEI** | The tracker's 15-digit IMEI (printed on the device / its box) |
| **Type** | vehicle · personal · asset · container |
| **Protocol** | `gt06`, `h02`, `teltonika`, or `nmea` (match your hardware) |
| **Registration number** | Optional vehicle plate |

The IMEI is how incoming GPS data is matched to this device, so it must match the
tracker exactly. New devices show as **Inactive** until they report.

---

## 3. Connect a real GPS tracker

Point the tracker at your TrackFlow ingest server (host + the port for its
protocol), then it appears live automatically.

| Protocol | Port | Typical devices |
|---|---|---|
| GT06 / GT06N | **5023** | Concox, most budget 2G/4G trackers (India's most common) |
| H02 | **5013** | Many budget/personal trackers |
| Teltonika Codec 8 | **5027** | Teltonika FMB/FMC professional units |
| NMEA 0183 | **5004** | Raw GPS modules (needs an identity prefix) |

Most Chinese trackers are configured by **SMS** to the SIM in the device. Exact
commands vary by model — check your tracker's manual — but a Concox GT06 looks like:

```
SERVER,1,track.yourdomain.com,5023,0#     set the server host + port
APN,jionet#                                set the SIM's APN (Jio shown)
GPRSON,1#                                   enable data
```

Then send `WHERE#` (or power-cycle) and the device should report within a minute.
**SIM tips (India):** an IoT/M2M data SIM (Jio/Airtel/BSNL) with ~1 GB/month is
plenty. Make sure the APN matches the carrier.

---

## 4. No hardware yet? Three ways to test

**a) Built-in simulator** — replays a moving device (create the device first so the
IMEI matches):
```bash
pnpm --filter @trackflow/ingest sim gt06 865432019876543
```

**b) Seed a demo fleet** — creates several devices and drives them around the map
(auto-raises your plan limit if needed):
```bash
TF_EMAIL=you@acme.app TF_PASSWORD=*** COUNT=8 pnpm --filter @trackflow/ingest seed
```

**c) Your phone** — install the TrackFlow mobile app (Expo), sign in, pick a device,
and **Start tracking** to report your real GPS.

---

## 5. Live Map

- Each device is an arrow that points in its direction of travel; **green = live**.
- Click a device (list or map) to fly to it, see speed/heading/coordinates, and
  draw its recent **track** trail.
- Updates stream in real time (no refresh needed).

---

## 6. Geofences

**Geofences → New zone.** Click the map to drop the center, set a radius, choose
**entry / exit** triggers and the **alert channels**, optionally add notify emails,
then **Save**. Any device entering or leaving fires an alert.

---

## 7. Alerts

The **Alerts** feed shows geofence and device events in real time with severity.
Click **Ack** to acknowledge. Alerts can be delivered over **email, SMS, push, and
webhooks** (configure providers in deployment).

---

## 8. Reports & analytics

**Reports** shows distance, trips, active devices, average speed, and a driver
score, with a distance-by-day chart. Trips are detected automatically from the
position stream. Use **Export CSV** to download the raw trip data.

---

## 9. Team, API, integrations (Settings)

- **Team** — invite teammates and assign roles (owner, admin, manager, user, viewer).
- **API keys** — create scoped keys for programmatic access; the full public API is
  documented at `/docs` (OpenAPI). Authenticate with `x-api-key` or a Bearer token.
- **Webhooks** — register an endpoint to receive **signed** event callbacks
  (`alert.triggered`, etc.); verify the `X-TrackFlow-Signature` HMAC.
- **Billing** — see your plan, device/user usage, upgrade, and download GST invoices.
- **Branding** — set your brand name, logo, primary color, and custom domain
  (white-label). The dashboard re-themes instantly.

---

## 10. Plans & limits

| Plan | Devices | Users |
|---|---|---|
| Free | 1 | 1 |
| Starter | 5 | 3 |
| Professional | 25 | 10 |
| Enterprise | Unlimited | Unlimited |

Adding a device beyond your plan returns a clear "limit reached — upgrade" message.

---

## Troubleshooting — device not showing up?

1. **IMEI mismatch** — the device's IMEI must exactly match the one you entered.
2. **Wrong server/port** — confirm the tracker points at your host and the right
   protocol port (GT06 → 5023, etc.).
3. **No data/APN** — verify the SIM has data and the correct APN.
4. **Plan limit** — if device creation was blocked, upgrade your plan.
5. Still stuck? Check the device's protocol matches the one selected.
