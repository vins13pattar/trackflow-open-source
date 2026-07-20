# TrackFlow — Observability ops

Monitoring config as code for the three runtime processes. Each exposes
`/metrics` (Prometheus text format) and `/health`, gated on `METRICS_TOKEN`
(see [`.env.example`](../.env.example)).

| Process | Metrics endpoint | Key series |
|---|---|---|
| API (`apps/api`) | `:8787/metrics` | `http_requests_total{method,status}`, `http_request_duration_seconds`, uptime |
| Ingest (`apps/ingest`) | `:9100/metrics` (`INGEST_HTTP_PORT`) | `ingest_messages_total`, `ingest_forwarded_total`, `ingest_decode_errors_total`, `ingest_sink_errors_total`, `ingest_active_connections` |
| Scheduler (`apps/jobs`) | `:9101/metrics` (`JOBS_HTTP_PORT`) | `job_runs_total{job,status}`, `job_run_duration_seconds`, `job_last_success_timestamp_seconds` |

## Files
- `prometheus/prometheus.example.yml` — scrape config for all three targets (Bearer = `METRICS_TOKEN`).
- `prometheus/alerts.yml` — SLO + burn-rate alert rules (PRD §6.1/§6.2 targets). Validate with `promtool check rules ops/prometheus/alerts.yml`.
- `grafana/trackflow-slo-dashboard.json` — import in Grafana (Dashboards → Import); pick your Prometheus datasource.

## SLOs encoded (from the PRD)
- **API availability 99.95%** — `APIHighErrorRate{Fast,Slow}` implement multi-window burn-rate alerting on the 5xx ratio.
- **API p95 < 300 ms** — `APILatencyP95High`.
- **Ingest 99.9%** — `IngestDown` + `IngestNoActiveConnections` (the always-on dependency).
- **Job freshness** — `JobStale` (no success in >26h) + `JobFailing`.

The `/health` endpoints double as the status-page / load-balancer probe targets;
`up{job=...}` drives the `*Down` alerts. Runbooks for each alert live in
[`../docs/RUNBOOKS.md`](../docs/RUNBOOKS.md).
