import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const adminUrl =
  process.env.ADMIN_DATABASE_URL ?? 'postgres://trackflow:trackflow@localhost:5432/trackflow';
const tenantUrl =
  process.env.DATABASE_URL ?? 'postgres://trackflow_app:trackflow_app@localhost:5432/trackflow';
const systemUrl =
  process.env.SYSTEM_DATABASE_URL ??
  'postgres://trackflow_system:trackflow_system@localhost:5432/trackflow';
const rowsPerTenant = Number(process.env.ROWS_PER_TENANT ?? 5_000);
const queryRuns = Number(process.env.DB_QUERY_N ?? 100);
const concurrency = Number(process.env.DB_CONCURRENCY ?? 10);
const p95BudgetMs = Number(process.env.DB_P95_BUDGET_MS ?? 0);
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.resolve(repoRoot, process.env.OUTPUT ?? 'benchmarks/results/db-local.json');

for (const [name, value] of Object.entries({
  ROWS_PER_TENANT: rowsPerTenant,
  DB_QUERY_N: queryRuns,
  DB_CONCURRENCY: concurrency,
})) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

const admin = postgres(adminUrl, { max: 2 });
const tenant = postgres(tenantUrl, { max: concurrency });
const system = postgres(systemUrl, { max: concurrency });
const runId = randomUUID();
const imeiSeed = String(BigInt(`0x${runId.replaceAll('-', '').slice(0, 12)}`) % 1_000_000_000_000n).padStart(12, '0');
const baseTime = new Date('2026-08-02T00:00:00.000Z');
const rangeStart = new Date(baseTime.getTime() - (rowsPerTenant + 1) * 1_000);
const fixtures: Array<{ tenantId: string; deviceId: string }> = [];
let cleanup = { attempted: false, remainingTenants: null as number | null, error: null as string | null };
let failure: string | null = null;

function percentile(sorted: number[], value: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)] ?? null;
}

async function measure(name: string, count: number, operation: (index: number) => Promise<void>) {
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
        if (sampleErrors.length < 10) sampleErrors.push((error as Error).message);
      } finally {
        samplesMs.push(performance.now() - started);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  const durationMs = performance.now() - startedAt;
  samplesMs.sort((a, b) => a - b);
  const total = samplesMs.reduce((sum, sample) => sum + sample, 0);
  return {
    name,
    queries: count,
    concurrency,
    durationMs,
    throughputPerSecond: durationMs > 0 ? (count / durationMs) * 1_000 : 0,
    errors,
    errorRate: errors / count,
    sampleErrors,
    latencyMs: {
      min: samplesMs[0] ?? null,
      p50: percentile(samplesMs, 50),
      p95: percentile(samplesMs, 95),
      p99: percentile(samplesMs, 99),
      max: samplesMs.at(-1) ?? null,
      mean: samplesMs.length > 0 ? total / samplesMs.length : null,
    },
    samplesMs,
  };
}

async function tenantHistory(tenantId: string, deviceId: string) {
  return tenant.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
    const rows = await tx<{ deviceId: string; tenantId: string }[]>`
      select device_id as "deviceId", tenant_id as "tenantId"
      from positions
      where device_id = ${deviceId}
        and fix_time between ${rangeStart} and ${baseTime}
      order by fix_time desc
      limit 100
    `;
    if (rows.length !== 100 || rows.some((row) => row.deviceId !== deviceId || row.tenantId !== tenantId)) {
      throw new Error(`tenant query returned unexpected rows for ${tenantId}`);
    }
  });
}

async function systemHistory(deviceId: string) {
  return system.begin(async (tx) => {
    const rows = await tx<{ deviceId: string }[]>`
      select device_id as "deviceId"
      from positions
      where device_id = ${deviceId}
        and fix_time between ${rangeStart} and ${baseTime}
      order by fix_time desc
      limit 100
    `;
    if (rows.length !== 100 || rows.some((row) => row.deviceId !== deviceId)) {
      throw new Error(`system query returned unexpected rows for ${deviceId}`);
    }
  });
}

let tenantQueries: Awaited<ReturnType<typeof measure>> | null = null;
let systemQueries: Awaited<ReturnType<typeof measure>> | null = null;
let noisyNeighbour: Awaited<ReturnType<typeof measure>> | null = null;
let explain: unknown = null;
let databaseEvidence: Record<string, unknown> = {};

try {
  await admin`select trackflow_ensure_positions_partition(date '2026-08-01')`;
  for (const suffix of ['a', 'b']) {
    const [tenantRow] = await admin<{ id: string }[]>`
      insert into tenants (name, slug)
      values (${`Synthetic DB Benchmark ${runId.slice(0, 8)} ${suffix}`}, ${`db-benchmark-${runId}-${suffix}`})
      returning id
    `;
    if (!tenantRow) throw new Error('failed to create benchmark tenant');
    const [deviceRow] = await admin<{ id: string }[]>`
      insert into devices (tenant_id, name, imei, type, protocol, status)
      values (
        ${tenantRow.id},
        ${`Synthetic DB device ${suffix}`},
        ${suffix === 'a' ? `991${imeiSeed}` : `992${imeiSeed}`},
        'asset',
        'gt06',
        'active'
      )
      returning id
    `;
    if (!deviceRow) throw new Error('failed to create benchmark device');
    fixtures.push({ tenantId: tenantRow.id, deviceId: deviceRow.id });
    await admin`
      insert into positions (device_id, tenant_id, lat, lon, speed_kph, course, gps_valid, fix_time, received_at)
      select
        ${deviceRow.id}::uuid,
        ${tenantRow.id}::uuid,
        12.90 + (series * 0.000001),
        77.60 + (series * 0.000001),
        series % 80,
        series % 360,
        true,
        ${baseTime}::timestamptz - make_interval(secs => series),
        ${baseTime}::timestamptz
      from generate_series(1, ${rowsPerTenant}) as series
    `;
  }

  const primary = fixtures[0]!;
  await tenantHistory(primary.tenantId, primary.deviceId);
  await systemHistory(primary.deviceId);

  tenantQueries = await measure('tenant-rls-history', queryRuns, () =>
    tenantHistory(primary.tenantId, primary.deviceId),
  );
  systemQueries = await measure('system-bypass-history', queryRuns, () => systemHistory(primary.deviceId));
  noisyNeighbour = await measure('two-tenant-noisy-neighbour', queryRuns * 2, (index) => {
    const fixture = fixtures[index % fixtures.length]!;
    return tenantHistory(fixture.tenantId, fixture.deviceId);
  });

  const explainRows = await tenant.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${primary.tenantId}, true)`;
    return tx<Record<string, unknown>[]>`
      explain (analyze, buffers, format json)
      select device_id, tenant_id, lat, lon, speed_kph, fix_time
      from positions
      where device_id = ${primary.deviceId}
        and fix_time between ${rangeStart} and ${baseTime}
      order by fix_time desc
      limit 100
    `;
  });
  explain = explainRows[0]?.['QUERY PLAN'] ?? null;

  const [parent] = await admin<{ relkind: string; rls: boolean; forceRls: boolean }[]>`
    select relkind, relrowsecurity as rls, relforcerowsecurity as "forceRls"
    from pg_class where oid = 'positions'::regclass
  `;
  const partitions = await admin<{ name: string; bound: string }[]>`
    select child.relname as name, pg_get_expr(child.relpartbound, child.oid) as bound
    from pg_inherits
    join pg_class child on child.oid = inhrelid
    where inhparent = 'positions'::regclass
    order by child.relname
  `;
  const indexes = await admin<{ name: string; definition: string }[]>`
    select indexname as name, indexdef as definition
    from pg_indexes where schemaname = 'public' and tablename = 'positions'
    order by indexname
  `;
  const policies = await admin<{ name: string; command: string; roles: string[] }[]>`
    select policyname as name, cmd as command, roles
    from pg_policies where schemaname = 'public' and tablename = 'positions'
    order by policyname
  `;
  const roles = await admin<{
    name: string;
    superuser: boolean;
    bypassRls: boolean;
  }[]>`
    select rolname as name, rolsuper as superuser, rolbypassrls as "bypassRls"
    from pg_roles where rolname in ('trackflow_app', 'trackflow_system')
    order by rolname
  `;
  const retentionFunctions = await system<{
    name: string;
    securityDefiner: boolean;
    executable: boolean;
  }[]>`
    select proname as name,
           prosecdef as "securityDefiner",
           has_function_privilege(current_user, oid, 'EXECUTE') as executable
    from pg_proc
    where proname in (
      'trackflow_ensure_positions_partition',
      'trackflow_provision_positions_partitions',
      'trackflow_drop_positions_partitions_before'
    )
    order by proname
  `;
  databaseEvidence = { parent, partitions, indexes, policies, roles, retentionFunctions };
} catch (error) {
  failure = (error as Error).message;
} finally {
  cleanup.attempted = true;
  try {
    const tenantIds = fixtures.map((fixture) => fixture.tenantId);
    if (tenantIds.length > 0) await admin`delete from tenants where id = any(${tenantIds}::uuid[])`;
    const [remaining] = await admin<{ count: number }[]>`
      select count(*)::int as count from tenants where slug like ${`db-benchmark-${runId}-%`}
    `;
    cleanup.remainingTenants = remaining?.count ?? -1;
  } catch (error) {
    cleanup.error = (error as Error).message;
  }
}

await Promise.allSettled([admin.end(), tenant.end(), system.end()]);

const failures: string[] = [];
if (failure) failures.push(failure);
for (const measurement of [tenantQueries, systemQueries, noisyNeighbour].filter(
  (value): value is Awaited<ReturnType<typeof measure>> => value !== null,
)) {
  if (measurement.errors > 0) failures.push(`${measurement.name} recorded ${measurement.errors} errors`);
  if (p95BudgetMs > 0 && (measurement.latencyMs.p95 ?? Number.POSITIVE_INFINITY) > p95BudgetMs) {
    failures.push(`${measurement.name} p95 ${measurement.latencyMs.p95?.toFixed(1)}ms exceeds ${p95BudgetMs}ms`);
  }
}
if (!tenantQueries || !systemQueries || !noisyNeighbour || !explain) failures.push('database evidence is incomplete');
if (cleanup.error || cleanup.remainingTenants !== 0) {
  failures.push(`synthetic fixture cleanup failed (${cleanup.error ?? cleanup.remainingTenants})`);
}

const tenantP95 = tenantQueries?.latencyMs.p95 ?? null;
const systemP95 = systemQueries?.latencyMs.p95 ?? null;
const result = {
  schemaVersion: 1,
  kind: 'trackflow.postgresql-local',
  generatedAt: new Date().toISOString(),
  evidence: {
    scope: 'local-synthetic',
    productionClaim: false,
    note: 'Local PostgreSQL without a hosted pooler, network latency, replicas, or production-shaped cardinality.',
  },
  runId,
  generator: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  },
  config: { rowsPerTenant, tenants: 2, queryRuns, concurrency, p95BudgetMs, rangeStart, baseTime },
  measurements: {
    tenantQueries,
    systemQueries,
    noisyNeighbour,
    rlsP95Ratio: tenantP95 !== null && systemP95 ? tenantP95 / systemP95 : null,
  },
  databaseEvidence,
  explain,
  cleanup,
  failures,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    tenant: tenantQueries && { p95Ms: tenantQueries.latencyMs.p95, errors: tenantQueries.errors },
    system: systemQueries && { p95Ms: systemQueries.latencyMs.p95, errors: systemQueries.errors },
    noisyNeighbour: noisyNeighbour && { p95Ms: noisyNeighbour.latencyMs.p95, errors: noisyNeighbour.errors },
    rlsP95Ratio: result.measurements.rlsP95Ratio,
    cleanup,
    failures,
  }),
);
if (failures.length > 0) process.exitCode = 1;
