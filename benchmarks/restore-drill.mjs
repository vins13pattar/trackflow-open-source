import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const container = process.env.RESTORE_DRILL_CONTAINER ?? 'trackflow-postgres';
const sourceDb = process.env.RESTORE_DRILL_SOURCE_DB ?? 'trackflow';
const targetDb = process.env.RESTORE_DRILL_TARGET_DB ?? 'trackflow_restore_drill';
const user = process.env.RESTORE_DRILL_DB_USER ?? 'trackflow';
const dumpPath = '/tmp/trackflow-restore-drill.dump';
const tenantId = randomUUID();
const deviceId = randomUUID();
const marker = `restore-drill-${Date.now()}`;

function docker(args, options = {}) {
  return execFileSync('docker', ['exec', container, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function sql(database, statement) {
  return docker(['psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', statement]);
}

const startedAt = new Date();
let backupDurationMs = 0;
let restoreDurationMs = 0;
let backupSizeBytes = 0;
let validations = {};

try {
  sql(
    sourceDb,
    `insert into tenants (id,name,slug) values ('${tenantId}','Restore Drill','${marker}');
     insert into devices (id,tenant_id,name,imei) values ('${deviceId}','${tenantId}','Synthetic restore marker','990009999999999');
     insert into positions (device_id,tenant_id,lat,lon,fix_time) values ('${deviceId}','${tenantId}',12.9716,77.5946,now());`,
  );

  const backupStarted = performance.now();
  docker(['pg_dump', '-U', user, '-d', sourceDb, '--format=custom', '--no-owner', '--file', dumpPath]);
  backupDurationMs = performance.now() - backupStarted;
  backupSizeBytes = Number(docker(['stat', '-c', '%s', dumpPath]));

  docker(['dropdb', '-U', user, '--if-exists', targetDb]);
  docker(['createdb', '-U', user, targetDb]);
  const restoreStarted = performance.now();
  docker(['pg_restore', '-U', user, '-d', targetDb, '--no-owner', '--exit-on-error', dumpPath]);
  restoreDurationMs = performance.now() - restoreStarted;

  validations = {
    syntheticMarkerRows: Number(sql(targetDb, `select count(*) from positions where device_id='${deviceId}'`)),
    migrationsApplied: Number(sql(targetDb, 'select count(*) from drizzle.__drizzle_migrations')),
    positionsRelkind: sql(targetDb, `select relkind from pg_class where oid='public.positions'::regclass`),
    forcedRlsTables: Number(
      sql(
        targetDb,
        `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relforcerowsecurity`,
      ),
    ),
  };
  if (
    validations.syntheticMarkerRows !== 1 ||
    validations.positionsRelkind !== 'p' ||
    validations.migrationsApplied < 1 ||
    validations.forcedRlsTables < 1
  ) {
    throw new Error(`Restore validation failed: ${JSON.stringify(validations)}`);
  }
} finally {
  try {
    sql(sourceDb, `delete from tenants where id='${tenantId}'`);
  } catch {}
  try {
    docker(['dropdb', '-U', user, '--if-exists', targetDb]);
  } catch {}
  try {
    docker(['rm', '-f', dumpPath]);
  } catch {}
}

const finishedAt = new Date();
const result = {
  schemaVersion: 1,
  kind: 'trackflow-postgres-restore-drill',
  measurement: 'direct',
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  environment: {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    dockerContainer: container,
    sourceDatabase: sourceDb,
    scratchDatabase: targetDb,
  },
  backup: { format: 'PostgreSQL custom', sizeBytes: backupSizeBytes, durationMs: backupDurationMs },
  restore: { durationMs: restoreDurationMs, validations },
  achieved: {
    rpo: '0 for this consistent local snapshot',
    rtoMs: restoreDurationMs,
  },
  intentionallyExcluded: [
    'Redis presence, session and rate-limit state',
    'Object-storage reports and exports',
    'Provider-side notification and payment records',
    'DNS and deployment-platform configuration',
  ],
  limitations: [
    'Local Docker restore is not a managed-service point-in-time recovery test.',
    'The source database contains synthetic test data and does not represent production volume.',
  ],
};

const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const outputArg = process.env.RESTORE_DRILL_OUTPUT ?? `benchmarks/results/restore-${stamp}.json`;
const output = path.resolve(outputArg);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, backupSizeBytes, backupDurationMs, restoreDurationMs, validations }));
