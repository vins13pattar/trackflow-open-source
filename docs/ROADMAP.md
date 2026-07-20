# TrackFlow — Practical-use Roadmap

Closing the gaps between "demo works" and "a fleet manager runs their business on it."

> **Status: shipped.** Phases A–E below are implemented. For the up-to-date status of the whole
> product and the forward plan, see **[PROJECT_PLAN.md](PROJECT_PLAN.md)** (the plan of record).

## Phase A — Device lifecycle & correctness (quick wins)
- **A1** Sidebar shows the real plan + usage (currently hardcoded "Free plan").
- **A2** "Live" derived from `lastSeen` freshness (not the stale `status` flag), so devices go offline when data stops; admin status is separate.
- **A3** Device **active/inactive** + edit/delete: `PUT`/`DELETE /devices/:id`, status on create, and device management UI.
- **A4** Geofence **enable/disable** + edit (API `PATCH` exists; add UI).

## Phase B — Telemetry / sensor data
- **B1** `attributes jsonb` on `positions` + `last_attributes` on `devices`; normalized keys (ignition, batteryPercent, batteryVoltage, externalVoltage, gsmSignal, charging, movement, fuelPercent, temperature, odometer, rpm, `io.<id>`).
- **B2** Decoders extract telemetry: Teltonika IO elements (currently skipped), GT06 status byte, H02 flags — with byte-level tests.
- **B3** Pipeline carries attributes (record + denormalize + SSE).
- **B4** Device detail telemetry panel (ignition on/off, battery, temperature, fuel, signal, voltage…) with friendly rendering + raw fallback.

## Phase C — Vehicles & multiple sensors per vehicle
- **C1** `vehicles` entity + `devices.vehicleId`; assign devices to a vehicle.
- **C2** Aggregate a vehicle's telemetry across all attached devices (position from the GPS device + merged sensor values).
- **C3** Live Map / detail by vehicle, showing all attached devices' combined data.

## Phase D — Offline detection & lifecycle alerts
- Scheduled job flips stale devices to offline and fires `device.offline`/`device.online` (through the existing alerts + webhooks pipeline).

## Phase E — In-app documentation & onboarding
- **E1** Help center (getting-started guide rendered in-app).
- **E2** Per-device **connection guide**: IMEI + ingest host:port for its protocol + copy-paste sample SMS to start streaming.
- **E3** First-run onboarding checklist + richer empty-state tips.

**Sequence:** A → E2 → B → E1/E3 → C → D.
