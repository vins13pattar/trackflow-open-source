import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pricingSnapshot = {
  asOf: '2026-07-28',
  currency: 'USD',
  fly: {
    shared1x256: 2.02,
    shared1x512: 3.32,
    shared2x1g: 6.64,
    shared2x2g: 11.83,
    shared2x4g: 22.22,
    indiaEgressPerGb: 0.12,
    source: 'https://fly.io/docs/about/pricing/',
  },
  neon: {
    launchCuHour: 0.106,
    scaleCuHour: 0.222,
    storageGbMonth: 0.35,
    source: 'https://neon.com/pricing',
  },
  upstash: {
    fixed250Mb: 10,
    fixed5Gb: 100,
    fixed50Gb: 400,
    productionHaAddon: 200,
    source: 'https://upstash.com/pricing/redis',
  },
  vercel: {
    proBase: 20,
    source: 'https://vercel.com/pricing',
  },
  r2: {
    storageGbMonth: 0.015,
    freeStorageGbMonth: 10,
    source: 'https://developers.cloudflare.com/r2/pricing/',
  },
};

const assumptions = {
  daysPerMonth: 30,
  retentionDays: 90,
  movingHoursPerDay: 8,
  movingIntervalSeconds: 30,
  stationaryHoursPerDay: 16,
  stationaryIntervalSeconds: 300,
  storedPositionAndIndexBytes: 250,
  ingestToApiPayloadBytes: 350,
  notificationEventsPerDeviceMonth: 1.5,
  estimatedNotificationUnitUsd: 0.005,
  reportStorageGbPerThousandDevices: 0.5,
  compressedBackupRatio: 0.2,
};

const positionsPerDeviceDay =
  (assumptions.movingHoursPerDay * 3600) / assumptions.movingIntervalSeconds +
  (assumptions.stationaryHoursPerDay * 3600) / assumptions.stationaryIntervalSeconds;

const tierInputs = [
  {
    devices: 1_000,
    neonPlan: 'launch',
    averageCu: 0.25,
    redisBaseUsd: pricingSnapshot.upstash.fixed250Mb,
    flyIngestUsd: 2 * pricingSnapshot.fly.shared1x512,
    flyApiUsd: 2 * pricingSnapshot.fly.shared1x512,
    flyJobsUsd: pricingSnapshot.fly.shared1x256,
    logsMetricsUsd: 10,
    requiredChanges: ['Second ingest instance plus TCP load-balancer health/drain validation', 'Redis-backed API fan-out'],
  },
  {
    devices: 10_000,
    neonPlan: 'scale',
    averageCu: 1,
    redisBaseUsd: pricingSnapshot.upstash.fixed5Gb,
    flyIngestUsd: 2 * pricingSnapshot.fly.shared2x2g,
    flyApiUsd: 2 * pricingSnapshot.fly.shared2x1g,
    flyJobsUsd: pricingSnapshot.fly.shared1x512,
    logsMetricsUsd: 30,
    requiredChanges: ['Measured multi-instance Redis fan-out', 'Connection-aware ingest placement', 'Database/query benchmark gate'],
  },
  {
    devices: 50_000,
    neonPlan: 'scale',
    averageCu: 4,
    redisBaseUsd: pricingSnapshot.upstash.fixed50Gb,
    flyIngestUsd: 4 * pricingSnapshot.fly.shared2x4g,
    flyApiUsd: 4 * pricingSnapshot.fly.shared2x2g,
    flyJobsUsd: 2 * pricingSnapshot.fly.shared2x1g,
    logsMetricsUsd: 100,
    requiredChanges: [
      'Shard ingest connection ownership',
      'Queue or log-based durable event handoff',
      'Read replicas for reporting',
      'Partition/archive tiering and a contracted HA/SLA posture',
    ],
  },
];

function estimate(input) {
  const monthlyPositions = input.devices * positionsPerDeviceDay * assumptions.daysPerMonth;
  const retainedPositionGb =
    (input.devices * positionsPerDeviceDay * assumptions.retentionDays * assumptions.storedPositionAndIndexBytes) / 1e9;
  const neonRate = input.neonPlan === 'launch' ? pricingSnapshot.neon.launchCuHour : pricingSnapshot.neon.scaleCuHour;
  const crossServiceGb = (monthlyPositions * assumptions.ingestToApiPayloadBytes) / 1e9;
  const reportGb = (input.devices / 1_000) * assumptions.reportStorageGbPerThousandDevices;
  const backupGb = retainedPositionGb * assumptions.compressedBackupRatio;
  const r2BillableGb = Math.max(0, reportGb + backupGb - pricingSnapshot.r2.freeStorageGbMonth);
  const components = {
    flyIngest: input.flyIngestUsd,
    flyApi: input.flyApiUsd,
    flyJobs: input.flyJobsUsd,
    neonCompute: input.averageCu * 730 * neonRate,
    neonStorage: retainedPositionGb * pricingSnapshot.neon.storageGbMonth,
    redis: input.redisBaseUsd,
    vercelWeb: pricingSnapshot.vercel.proBase,
    flyCrossServiceEgress: crossServiceGb * pricingSnapshot.fly.indiaEgressPerGb,
    logsAndMetricsAllowance: input.logsMetricsUsd,
    r2ReportsAndLogicalBackups: r2BillableGb * pricingSnapshot.r2.storageGbMonth,
    notifications:
      input.devices * assumptions.notificationEventsPerDeviceMonth * assumptions.estimatedNotificationUnitUsd,
  };
  const leanMonthlyUsd = Object.values(components).reduce((sum, value) => sum + value, 0);
  const haMonthlyUsd = leanMonthlyUsd + pricingSnapshot.upstash.productionHaAddon;
  return {
    devices: input.devices,
    classification: 'estimate',
    monthlyPositions,
    retainedPositionGb,
    crossServiceGb,
    reportGb,
    compressedLogicalBackupGb: backupGb,
    components,
    leanMonthlyUsd,
    haMonthlyUsd,
    leanCostPerActiveDeviceUsd: leanMonthlyUsd / input.devices,
    haCostPerActiveDeviceUsd: haMonthlyUsd / input.devices,
    largestCostDrivers: Object.entries(components)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name, monthlyUsd]) => ({ name, monthlyUsd })),
    requiredChanges: input.requiredChanges,
  };
}

const result = {
  schemaVersion: 1,
  kind: 'trackflow-capacity-cost-model',
  classification: 'estimated-not-billed',
  pricingSnapshot,
  assumptions: { ...assumptions, positionsPerDeviceDay },
  tiers: tierInputs.map(estimate),
  exclusions: [
    'Taxes, support contracts, custom enterprise pricing and engineering labour',
    'SMS/WhatsApp country-specific provider tariffs beyond the explicit unit hypothesis',
    'Vercel Enterprise multi-region failover, whose price is custom',
    'Database historical-storage/PITR overages not shown on the public summary price',
  ],
};

const output = path.resolve(process.env.COST_MODEL_OUTPUT ?? 'benchmarks/results/cost-model.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const money = (value) => `$${value.toFixed(2)}`;
const markdown = `# TrackFlow cost and capacity model

Pricing snapshot: ${pricingSnapshot.asOf}. All values are estimates, not bills.
Re-run with \`pnpm cost:model\`; edit only the explicit inputs in
\`benchmarks/cost-model.mjs\`.

## Workload assumptions

- ${positionsPerDeviceDay} fixes/device/day: ${assumptions.movingHoursPerDay} moving hours at ${assumptions.movingIntervalSeconds}s and ${assumptions.stationaryHoursPerDay} stationary hours at ${assumptions.stationaryIntervalSeconds}s.
- ${assumptions.retentionDays}-day hot retention and ${assumptions.storedPositionAndIndexBytes} bytes/position including index allowance.
- ${assumptions.ingestToApiPayloadBytes} bytes of cross-service normalized payload per position.
- ${assumptions.notificationEventsPerDeviceMonth} billable notifications/device/month at a hypothetical ${money(assumptions.estimatedNotificationUnitUsd)} each.
- HA total adds the public Upstash production HA pack; other enterprise/SLA contracts remain excluded.

| Devices | Positions/month | Hot position GB | Lean estimate | HA estimate | Lean/device | HA/device |
|---:|---:|---:|---:|---:|---:|---:|
${result.tiers
  .map(
    (tier) =>
      `| ${tier.devices.toLocaleString()} | ${tier.monthlyPositions.toLocaleString()} | ${tier.retainedPositionGb.toFixed(1)} | ${money(tier.leanMonthlyUsd)} | ${money(tier.haMonthlyUsd)} | ${money(tier.leanCostPerActiveDeviceUsd)} | ${money(tier.haCostPerActiveDeviceUsd)} |`,
  )
  .join('\n')}

## Components and scaling boundaries

${result.tiers
  .map(
    (tier) => `### ${tier.devices.toLocaleString()} devices

Largest modeled drivers: ${tier.largestCostDrivers.map((driver) => `${driver.name} ${money(driver.monthlyUsd)}`).join(', ')}.

Required architecture changes:
${tier.requiredChanges.map((change) => `- ${change}`).join('\n')}
`,
  )
  .join('\n')}

## Pricing sources

- [Fly.io compute and India egress](${pricingSnapshot.fly.source})
- [Neon compute and storage](${pricingSnapshot.neon.source})
- [Upstash Redis plans and HA add-on](${pricingSnapshot.upstash.source})
- [Vercel Pro](${pricingSnapshot.vercel.source})
- [Cloudflare R2](${pricingSnapshot.r2.source})

## Limitations

${result.exclusions.map((item) => `- ${item}`).join('\n')}
`;
const report = path.resolve(process.env.COST_REPORT_OUTPUT ?? 'docs/case-study/cost-model.md');
await mkdir(path.dirname(report), { recursive: true });
await writeFile(report, markdown, 'utf8');
console.log(JSON.stringify({ output, report, tiers: result.tiers.map((tier) => ({ devices: tier.devices, leanMonthlyUsd: tier.leanMonthlyUsd, haMonthlyUsd: tier.haMonthlyUsd })) }));
