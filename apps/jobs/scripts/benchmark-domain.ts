import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  alertDeliveries,
  alerts,
  and,
  dailyRollups,
  devices,
  eq,
  geofences,
  tenants,
  trips,
  withSystem,
} from '@trackflow/db';
import { buildRegistry, ok, type Channel } from '@trackflow/notifications';
import { evaluateGeofences } from '../../api/src/geofence-service.js';
import { db } from '../src/db.js';
import { rebuildDailyRollups } from '../src/daily-rollup.js';
import { retryDueDeliveries } from '../src/notify-retry.js';
import { renderReportPdf, type ReportRow } from '../src/report-pdf.js';

const deviceCount = Number(process.env.DOMAIN_DEVICES ?? 50);
const geofenceCount = Number(process.env.DOMAIN_GEOFENCES ?? 10);
const tripsPerDevice = Number(process.env.DOMAIN_TRIPS_PER_DEVICE ?? 20);
const reportRuns = Number(process.env.DOMAIN_REPORT_RUNS ?? 5);
const concurrency = Number(process.env.DOMAIN_CONCURRENCY ?? 10);
const geofenceP95BudgetMs = Number(process.env.DOMAIN_GEOFENCE_P95_BUDGET_MS ?? 0);
const retryBudgetMs = Number(process.env.DOMAIN_RETRY_BUDGET_MS ?? 0);
const rollupBudgetMs = Number(process.env.DOMAIN_ROLLUP_BUDGET_MS ?? 0);
const reportP95BudgetMs = Number(process.env.DOMAIN_REPORT_P95_BUDGET_MS ?? 0);
const output = process.env.OUTPUT ?? 'benchmarks/results/domain-local.json';
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputPath = path.isAbsolute(output) ? output : path.resolve(workspaceRoot, output);

for (const [name, value] of Object.entries({
  DOMAIN_DEVICES: deviceCount,
  DOMAIN_GEOFENCES: geofenceCount,
  DOMAIN_TRIPS_PER_DEVICE: tripsPerDevice,
  DOMAIN_REPORT_RUNS: reportRuns,
  DOMAIN_CONCURRENCY: concurrency,
})) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(values: number[]) {
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    samples: values.length,
    min: values.length > 0 ? Math.min(...values) : null,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: values.length > 0 ? Math.max(...values) : null,
    mean: values.length > 0 ? sum / values.length : null,
  };
}

async function measure(count: number, operation: (index: number) => Promise<void>) {
  const samplesMs: number[] = [];
  const sampleErrors: string[] = [];
  let errors = 0;
  let cursor = 0;
  const startedAt = performance.now();
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      const started = performance.now();
      try {
        await operation(index);
      } catch (error) {
        errors += 1;
        if (sampleErrors.length < 10) sampleErrors.push(error instanceof Error ? error.message : String(error));
      } finally {
        samplesMs.push(performance.now() - started);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  const durationMs = performance.now() - startedAt;
  return {
    operations: count,
    concurrency,
    durationMs,
    throughputPerSecond: durationMs > 0 ? (count / durationMs) * 1_000 : 0,
    errors,
    sampleErrors,
    latencyMs: summarize(samplesMs),
    samplesMs,
  };
}

const runId = randomUUID();
const slug = `domain-benchmark-${runId}`;
const now = new Date();
const reportBaseTime = new Date(now.getTime() - 86_400_000);
reportBaseTime.setUTCHours(12, 0, 0, 0);
const dayCount = Math.min(5, tripsPerDevice);
const failures: string[] = [];
let tenantId: string | null = null;
let deviceRows: Array<{ id: string; name: string }> = [];
let geofenceInitialization: Awaited<ReturnType<typeof measure>> | null = null;
let geofenceMeasurement: Awaited<ReturnType<typeof measure>> | null = null;
let alertsCreated = 0;
let notificationBacklog = 0;
let retryMeasurement: {
  durationMs: number;
  batches: number;
  batchLatencyMs: ReturnType<typeof summarize>;
  samplesMs: number[];
  checked: number;
  sent: number;
  requeued: number;
  abandoned: number;
  remainingFailed: number;
} | null = null;
let rollupMeasurement: { durationMs: number; expectedRows: number; actualRows: number } | null = null;
let reportMeasurement: Awaited<ReturnType<typeof measure>> | null = null;
let reportBytes = 0;
let cleanup = { attempted: false, remainingTenants: null as number | null, error: null as string | null };

try {
  const [tenant] = await withSystem(db, 'test-fixture', (tx) =>
    tx
      .insert(tenants)
      .values({ name: `Synthetic Domain Benchmark ${runId.slice(0, 8)}`, slug })
      .returning({ id: tenants.id }),
  );
  if (!tenant) throw new Error('failed to create synthetic tenant');
  tenantId = tenant.id;

  const imeiSeed = BigInt(`0x${runId.replaceAll('-', '').slice(0, 12)}`) % 1_000_000_000_000n;
  deviceRows = await withSystem(db, 'test-fixture', (tx) =>
    tx
      .insert(devices)
      .values(
        Array.from({ length: deviceCount }, (_, index) => ({
          tenantId: tenant.id,
          name: `Synthetic domain device ${index + 1}`,
          imei: `996${String((imeiSeed + BigInt(index)) % 1_000_000_000_000n).padStart(12, '0')}`,
          type: 'asset',
          protocol: 'gt06',
          status: 'active',
        })),
      )
      .returning({ id: devices.id, name: devices.name }),
  );
  await withSystem(db, 'test-fixture', (tx) =>
    tx.insert(geofences).values(
      Array.from({ length: geofenceCount }, (_, index) => ({
        tenantId: tenant.id,
        name: `Synthetic Mumbai geofence ${index + 1}`,
        type: 'circle',
        centerLat: 19.076,
        centerLon: 72.8777,
        radiusM: 1_000,
        onEntry: true,
        onExit: true,
        onDwell: false,
        channels: ['email'],
        recipients: { emails: ['synthetic@example.test'] },
        allDevices: true,
        status: 'active',
      })),
    ),
  );

  geofenceInitialization = await measure(deviceRows.length, async (index) => {
    const device = deviceRows[index]!;
    const fired = await withSystem(db, 'test-fixture', (tx) =>
      evaluateGeofences(tx, { tenantId: tenant.id, deviceId: device.id, lat: 19.25, lon: 73.05, fixTime: now }),
    );
    if (fired.length !== 0) throw new Error(`outside initialization fired ${fired.length} alerts`);
  });

  geofenceMeasurement = await measure(deviceRows.length, async (index) => {
    const device = deviceRows[index]!;
    const fired = await withSystem(db, 'test-fixture', (tx) =>
      evaluateGeofences(tx, {
        tenantId: tenant.id,
        deviceId: device.id,
        lat: 19.076,
        lon: 72.8777,
        fixTime: new Date(now.getTime() + 1_000),
      }),
    );
    if (fired.length !== geofenceCount) throw new Error(`expected ${geofenceCount} entry alerts, saw ${fired.length}`);
  });

  const alertRows = await withSystem(db, 'test-fixture', (tx) =>
    tx.select({ id: alerts.id }).from(alerts).where(eq(alerts.tenantId, tenant.id)),
  );
  alertsCreated = alertRows.length;
  if (alertsCreated !== deviceCount * geofenceCount) {
    throw new Error(`expected ${deviceCount * geofenceCount} alerts, saw ${alertsCreated}`);
  }

  const dueAt = new Date(now.getTime() - 1_000);
  await withSystem(db, 'test-fixture', (tx) =>
    tx.insert(alertDeliveries).values(
      alertRows.map((alert) => ({
        tenantId: tenant.id,
        alertId: alert.id,
        channel: 'email',
        recipient: 'synthetic@example.test',
        subject: 'Synthetic benchmark alert',
        body: 'Synthetic data only',
        status: 'failed',
        attempt: 1,
        error: 'synthetic transient failure',
        nextRetryAt: dueAt,
      })),
    ),
  );
  notificationBacklog = alertRows.length;
  const registry = buildRegistry();
  registry.email = {
    name: 'email',
    async send(_message, recipients) {
      return (recipients.emails ?? []).map((recipient) => ok('email', recipient));
    },
  } satisfies Channel;
  const retryStartedAt = performance.now();
  const retrySamples: number[] = [];
  let checked = 0;
  let sent = 0;
  let requeued = 0;
  let abandoned = 0;
  while (true) {
    const batchStartedAt = performance.now();
    const batch = await retryDueDeliveries(now, registry);
    retrySamples.push(performance.now() - batchStartedAt);
    checked += batch.checked;
    sent += batch.sent;
    requeued += batch.requeued;
    abandoned += batch.abandoned;
    if (batch.checked === 0) break;
  }
  const remainingFailed = (
    await withSystem(db, 'test-fixture', (tx) =>
      tx
        .select({ id: alertDeliveries.id })
        .from(alertDeliveries)
        .where(and(eq(alertDeliveries.tenantId, tenant.id), eq(alertDeliveries.status, 'failed'))),
    )
  ).length;
  retryMeasurement = {
    durationMs: performance.now() - retryStartedAt,
    batches: retrySamples.length - 1,
    batchLatencyMs: summarize(retrySamples.slice(0, -1)),
    samplesMs: retrySamples.slice(0, -1),
    checked,
    sent,
    requeued,
    abandoned,
    remainingFailed,
  };

  const tripRows = deviceRows.flatMap((device, deviceIndex) =>
    Array.from({ length: tripsPerDevice }, (_, tripIndex) => {
      const dayOffset = tripIndex % dayCount;
      const startedAt = new Date(
        reportBaseTime.getTime() - dayOffset * 86_400_000 - (deviceIndex * tripsPerDevice + tripIndex) * 1_000,
      );
      return {
        tenantId: tenant.id,
        deviceId: device.id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + 1_800_000),
        durationS: 1_800,
        distanceKm: 12.5,
        avgSpeedKph: 25,
        maxSpeedKph: 55,
        pointCount: 60,
        speedingSamples: 2,
      };
    }),
  );
  await withSystem(db, 'test-fixture', (tx) => tx.insert(trips).values(tripRows));
  const rollupStartedAt = performance.now();
  await rebuildDailyRollups(new Date(now.getTime() - 7 * 86_400_000));
  const rollupDurationMs = performance.now() - rollupStartedAt;
  const actualRollups = (
    await withSystem(db, 'test-fixture', (tx) =>
      tx.select({ id: dailyRollups.id }).from(dailyRollups).where(eq(dailyRollups.tenantId, tenant.id)),
    )
  ).length;
  rollupMeasurement = { durationMs: rollupDurationMs, expectedRows: deviceCount * dayCount, actualRows: actualRollups };

  const reportRows: ReportRow[] = deviceRows.map((device) => ({
    device: device.name,
    trips: tripsPerDevice,
    distanceKm: tripsPerDevice * 12.5,
    avgSpeedKph: 25,
    speedingSamples: tripsPerDevice * 2,
  }));
  reportMeasurement = await measure(reportRuns, async () => {
    const csv = [
      'device,trips,distance_km,avg_speed_kph,speeding_samples',
      ...reportRows.map(
        (row) =>
          `${JSON.stringify(row.device)},${row.trips},${row.distanceKm.toFixed(2)},${row.avgSpeedKph.toFixed(1)},${row.speedingSamples}`,
      ),
    ].join('\n');
    const pdf = await renderReportPdf({
      title: 'TrackFlow synthetic domain benchmark',
      periodLabel: 'Synthetic seven-day window',
      rows: reportRows,
      totals: { trips: deviceCount * tripsPerDevice, distanceKm: deviceCount * tripsPerDevice * 12.5, devices: deviceCount },
    });
    reportBytes = Buffer.byteLength(csv) + pdf.byteLength;
    if (Buffer.from(pdf).subarray(0, 4).toString() !== '%PDF' || reportBytes < 1_000) {
      throw new Error('report output was incomplete');
    }
  });
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  cleanup.attempted = true;
  try {
    if (tenantId) await withSystem(db, 'test-fixture', (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId!)));
    const remaining = await withSystem(db, 'test-fixture', (tx) =>
      tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)),
    );
    cleanup.remainingTenants = remaining.length;
  } catch (error) {
    cleanup.error = error instanceof Error ? error.message : String(error);
  }
}

if (!geofenceInitialization || geofenceInitialization.errors > 0) failures.push('geofence initialization is incomplete');
if (!geofenceMeasurement || geofenceMeasurement.errors > 0) failures.push('geofence/alert measurement is incomplete');
if (geofenceP95BudgetMs > 0 && (geofenceMeasurement?.latencyMs.p95 ?? Infinity) > geofenceP95BudgetMs) {
  failures.push(`geofence p95 ${geofenceMeasurement?.latencyMs.p95?.toFixed(1)}ms exceeds ${geofenceP95BudgetMs}ms`);
}
if (
  !retryMeasurement ||
  retryMeasurement.sent !== notificationBacklog ||
  retryMeasurement.requeued !== 0 ||
  retryMeasurement.abandoned !== 0 ||
  retryMeasurement.remainingFailed !== 0
) {
  failures.push('notification backlog did not recover exactly once');
}
if (retryBudgetMs > 0 && (retryMeasurement?.durationMs ?? Infinity) > retryBudgetMs) {
  failures.push(`notification recovery ${retryMeasurement?.durationMs.toFixed(1)}ms exceeds ${retryBudgetMs}ms`);
}
if (!rollupMeasurement || rollupMeasurement.actualRows !== rollupMeasurement.expectedRows) {
  failures.push(`rollup row count mismatch (${rollupMeasurement?.actualRows ?? 'missing'}/${rollupMeasurement?.expectedRows ?? 'missing'})`);
}
if (rollupBudgetMs > 0 && (rollupMeasurement?.durationMs ?? Infinity) > rollupBudgetMs) {
  failures.push(`rollup recovery ${rollupMeasurement?.durationMs.toFixed(1)}ms exceeds ${rollupBudgetMs}ms`);
}
if (!reportMeasurement || reportMeasurement.errors > 0) failures.push('report rendering measurement is incomplete');
if (reportP95BudgetMs > 0 && (reportMeasurement?.latencyMs.p95 ?? Infinity) > reportP95BudgetMs) {
  failures.push(`report p95 ${reportMeasurement?.latencyMs.p95?.toFixed(1)}ms exceeds ${reportP95BudgetMs}ms`);
}
if (cleanup.error || cleanup.remainingTenants !== 0) {
  failures.push(`synthetic fixture cleanup failed (${cleanup.error ?? cleanup.remainingTenants})`);
}

const result = {
  schemaVersion: 1,
  kind: 'trackflow.domain-workflows',
  generatedAt: new Date().toISOString(),
  evidence: {
    scope: 'local-synthetic',
    productionClaim: false,
    note: 'Local PostgreSQL domain services with an in-memory successful notification channel. No external provider, hosted network, object storage, or production data.',
  },
  runId,
  generator: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  config: {
    deviceCount,
    geofenceCount,
    tripsPerDevice,
    reportRuns,
    concurrency,
    budgets: { geofenceP95Ms: geofenceP95BudgetMs, retryMs: retryBudgetMs, rollupMs: rollupBudgetMs, reportP95Ms: reportP95BudgetMs },
  },
  measurements: {
    geofenceInitialization,
    geofenceAndAlert: {
      ...geofenceMeasurement,
      alertsCreated,
      alertsPerSecond:
        geofenceMeasurement && geofenceMeasurement.durationMs > 0
          ? (alertsCreated / geofenceMeasurement.durationMs) * 1_000
          : 0,
    },
    notificationBacklog: { queued: notificationBacklog, ...retryMeasurement },
    reportBacklog: {
      tripsProcessed: deviceCount * tripsPerDevice,
      rollup: rollupMeasurement,
      rendering: reportMeasurement,
      outputBytesPerRun: reportBytes,
    },
  },
  cleanup,
  failures,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    geofence: geofenceMeasurement && {
      p50Ms: geofenceMeasurement.latencyMs.p50,
      p95Ms: geofenceMeasurement.latencyMs.p95,
      p99Ms: geofenceMeasurement.latencyMs.p99,
      alertsCreated,
      errors: geofenceMeasurement.errors,
    },
    notificationBacklog: retryMeasurement && {
      queued: notificationBacklog,
      recovered: retryMeasurement.sent,
      durationMs: retryMeasurement.durationMs,
      batches: retryMeasurement.batches,
      remainingFailed: retryMeasurement.remainingFailed,
    },
    reportBacklog: {
      trips: deviceCount * tripsPerDevice,
      rollupMs: rollupMeasurement?.durationMs,
      rollupRows: rollupMeasurement && `${rollupMeasurement.actualRows}/${rollupMeasurement.expectedRows}`,
      reportP95Ms: reportMeasurement?.latencyMs.p95,
      reportBytes,
    },
    cleanup,
    failures,
  }),
);
process.exit(failures.length > 0 ? 1 : 0);
