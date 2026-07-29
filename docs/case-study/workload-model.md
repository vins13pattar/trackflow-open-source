# Workload and capacity model

This model makes TrackFlow's engineering assumptions explicit. It is not a
claim that every tier has been tested. All traffic and benchmark identities are
synthetic.

## Operating assumptions

| Dimension | Development | Baseline | Scale | Design target | Stretch model |
|---|---:|---:|---:|---:|---:|
| Registered devices | 100 | 1,000 | 10,000 | 50,000 | 100,000 |
| Concurrent TCP connections | 80 | 800 | 8,000 | 40,000 | 80,000 |
| Dashboard users, peak | 10 | 75 | 500 | 2,000 | 4,000 |
| SSE subscriptions, peak | 10 | 100 | 750 | 3,000 | 6,000 |
| Mobile/API requests, peak | 5 rps | 25 rps | 200 rps | 800 rps | 1,500 rps |
| Scheduled reports/day | 5 | 50 | 500 | 2,500 | 5,000 |
| Notifications/month | 150 | 1,500 | 15,000 | 75,000 | 150,000 |

Each active device reports every 30 seconds for eight moving hours and every
300 seconds for sixteen stationary hours: 1,152 positions/device/day. The
retention model keeps 90 days hot. A normalized position plus index allowance
is estimated at 250 bytes; wire frames vary by protocol and are modeled as
60–160 bytes with a 100-byte average.

Normal connection churn is 1% of connected devices/hour. The recovery scenario
reconnects 25% of devices within five minutes. Geofence and alert rules are
evaluated once per accepted position. Report and notification figures are
planning assumptions, not measured production traffic.

## Derived rates

| Tier | Average positions/s | Moving-window positions/s | 90-day positions | Modeled hot storage |
|---|---:|---:|---:|---:|
| 100 | 1.3 | 3.3 | 10.4M | 2.6 GB |
| 1,000 | 13.3 | 33.3 | 103.7M | 25.9 GB |
| 10,000 | 133.3 | 333.3 | 1.04B | 259.2 GB |
| 50,000 | 666.7 | 1,666.7 | 5.18B | 1.30 TB |
| 100,000 | 1,333.3 | 3,333.3 | 10.37B | 2.59 TB |

The cost model uses decimal GB. Real storage depends on PostgreSQL tuple,
WAL, vacuum, compression, index, replica, and backup behaviour and must be
measured before procurement.

## Evidence classification

- **Directly measured:** one local 1,000-connection mixed-protocol TCP ingest
  run before and after parser hardening.
- **Implemented but not capacity-validated:** bounded sink queue, retry limits,
  readiness, liveness, graceful drain, protocol error categorization, and the
  local synthetic restore drill.
- **Estimated:** storage, network, notification volume, and monthly cost.
- **Unverified targets:** 10,000, 50,000, and 100,000 devices; API,
  PostgreSQL, SSE, and domain-processing capacity; multi-replica behaviour.

The 1,000-device TCP result is not evidence that the complete platform supports
1,000 devices. It isolates the decoder-to-mock-sink boundary on one developer
machine.
