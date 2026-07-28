# TrackFlow cost and capacity model

Pricing snapshot: 2026-07-28. All values are estimates, not bills.
Re-run with `pnpm cost:model`; edit only the explicit inputs in
`benchmarks/cost-model.mjs`.

## Workload assumptions

- 1152 fixes/device/day: 8 moving hours at 30s and 16 stationary hours at 300s.
- 90-day hot retention and 250 bytes/position including index allowance.
- 350 bytes of cross-service normalized payload per position.
- 1.5 billable notifications/device/month at a hypothetical $0.01 each.
- HA total adds the public Upstash production HA pack; other enterprise/SLA contracts remain excluded.

| Devices | Positions/month | Hot position GB | Lean estimate | HA estimate | Lean/device | HA/device |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 34,560,000 | 25.9 | $92.67 | $292.67 | $0.09 | $0.29 |
| 10,000 | 345,600,000 | 259.2 | $533.26 | $733.26 | $0.05 | $0.07 |
| 50,000 | 1,728,000,000 | 1296.0 | $2223.01 | $2423.01 | $0.04 | $0.05 |

## Components and scaling boundaries

### 1,000 devices

Largest modeled drivers: vercelWeb $20.00, neonCompute $19.34, redis $10.00.

Required architecture changes:
- Second ingest instance plus TCP load-balancer health/drain validation
- Redis-backed API fan-out

### 10,000 devices

Largest modeled drivers: neonCompute $162.06, redis $100.00, neonStorage $90.72.

Required architecture changes:
- Measured multi-instance Redis fan-out
- Connection-aware ingest placement
- Database/query benchmark gate

### 50,000 devices

Largest modeled drivers: neonCompute $648.24, neonStorage $453.60, redis $400.00.

Required architecture changes:
- Shard ingest connection ownership
- Queue or log-based durable event handoff
- Read replicas for reporting
- Partition/archive tiering and a contracted HA/SLA posture


## Pricing sources

- [Fly.io compute and India egress](https://fly.io/docs/about/pricing/)
- [Neon compute and storage](https://neon.com/pricing)
- [Upstash Redis plans and HA add-on](https://upstash.com/pricing/redis)
- [Vercel Pro](https://vercel.com/pricing)
- [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/)

## Limitations

- Taxes, support contracts, custom enterprise pricing and engineering labour
- SMS/WhatsApp country-specific provider tariffs beyond the explicit unit hypothesis
- Vercel Enterprise multi-region failover, whose price is custom
- Database historical-storage/PITR overages not shown on the public summary price
