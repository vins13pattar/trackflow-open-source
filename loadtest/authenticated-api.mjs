import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const target = process.env.TARGET ?? 'http://127.0.0.1:8787';
const readRequests = Number(process.env.READ_N ?? 200);
const writeRequests = Number(process.env.WRITE_N ?? 100);
const concurrency = Number(process.env.CONCURRENCY ?? 20);
const warmupRequests = Number(process.env.WARMUP_N ?? 10);
const output = process.env.OUTPUT ?? 'benchmarks/results/api-local.json';
const readP95BudgetMs = Number(process.env.READ_P95_BUDGET_MS ?? 0);
const writeP95BudgetMs = Number(process.env.WRITE_P95_BUDGET_MS ?? 0);
const maxErrorRate = Number(process.env.MAX_ERROR_RATE ?? 0.01);

for (const [name, value] of Object.entries({
  READ_N: readRequests,
  WRITE_N: writeRequests,
  CONCURRENCY: concurrency,
  WARMUP_N: warmupRequests,
})) {
  if (!Number.isInteger(value) || value < 0 || (name === 'CONCURRENCY' && value < 1)) {
    throw new Error(`${name} must be a valid non-negative integer`);
  }
}

const runId = randomUUID();
const password = `Synthetic-${runId}-Aa1!`;
const email = `benchmark.${runId}@example.test`;
const imei = `990${String(Date.now() % 1_000_000_000_000).padStart(12, '0')}`;
let accessToken = '';
let deviceId = '';
let cleanup = { attempted: false, status: null, error: null };

async function jsonRequest(route, init = {}, expected = [200]) {
  const response = await fetch(new URL(route, target), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${init.method ?? 'GET'} ${route} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measure(name, count, operation) {
  const samplesMs = [];
  const statusCounts = {};
  const sampleErrors = [];
  let cursor = 0;
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      const started = performance.now();
      try {
        const status = await operation(index);
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      } catch (error) {
        statusCounts.error = (statusCounts.error ?? 0) + 1;
        if (sampleErrors.length < 10) sampleErrors.push((error).message);
      } finally {
        samplesMs.push(performance.now() - started);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(count, 1)) }, worker));
  const durationMs = performance.now() - startedAt;
  samplesMs.sort((a, b) => a - b);
  const errors = statusCounts.error ?? 0;
  const sum = samplesMs.reduce((total, value) => total + value, 0);
  return {
    name,
    requests: count,
    concurrency,
    durationMs,
    throughputPerSecond: durationMs > 0 ? (count / durationMs) * 1000 : 0,
    errors,
    errorRate: count > 0 ? errors / count : 0,
    statusCounts,
    sampleErrors,
    latencyMs: {
      min: samplesMs[0] ?? null,
      p50: percentile(samplesMs, 50),
      p95: percentile(samplesMs, 95),
      p99: percentile(samplesMs, 99),
      max: samplesMs.at(-1) ?? null,
      mean: samplesMs.length > 0 ? sum / samplesMs.length : null,
    },
    samplesMs,
  };
}

async function rawRequest(route, init = {}) {
  const response = await fetch(new URL(route, target), {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${route} returned ${response.status}`);
  return response.status;
}

let read;
let write;
let failure;
try {
  const registration = await jsonRequest(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        name: 'Synthetic API Benchmark',
        tenantName: `Synthetic API Benchmark ${runId.slice(0, 8)}`,
      }),
    },
    [201],
  );
  accessToken = registration.tokens.accessToken;
  const device = await jsonRequest(
    '/devices',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Synthetic benchmark device',
        imei,
        type: 'asset',
        protocol: 'gt06',
        status: 'active',
      }),
    },
    [201],
  );
  deviceId = device.id;

  for (let index = 0; index < warmupRequests; index += 1) {
    await rawRequest('/devices');
    await rawRequest(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: `Synthetic benchmark device ${index % 2}` }),
    });
  }

  read = await measure('authenticated-device-list', readRequests, () => rawRequest('/devices'));
  write = await measure('authenticated-device-update', writeRequests, (index) =>
    rawRequest(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: `Synthetic benchmark device ${index % 2}` }),
    }),
  );
} catch (error) {
  failure = (error).message;
} finally {
  if (accessToken) {
    cleanup.attempted = true;
    try {
      const response = await fetch(new URL('/me/tenant', target), {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ password, confirm: 'delete my workspace' }),
      });
      cleanup.status = response.status;
      if (response.status !== 204) cleanup.error = (await response.text()).slice(0, 200);
    } catch (error) {
      cleanup.error = (error).message;
    }
  }
}

const failures = [];
if (failure) failures.push(failure);
if (!read || !write) failures.push('benchmark measurements are incomplete');
for (const measurement of [read, write].filter(Boolean)) {
  if (measurement.errorRate > maxErrorRate) {
    failures.push(
      `${measurement.name} error rate ${(measurement.errorRate * 100).toFixed(2)}% exceeds ${(maxErrorRate * 100).toFixed(2)}%`,
    );
  }
}
if (readP95BudgetMs > 0 && read?.latencyMs.p95 > readP95BudgetMs) {
  failures.push(`read p95 ${read.latencyMs.p95.toFixed(1)}ms exceeds ${readP95BudgetMs}ms`);
}
if (writeP95BudgetMs > 0 && write?.latencyMs.p95 > writeP95BudgetMs) {
  failures.push(`write p95 ${write.latencyMs.p95.toFixed(1)}ms exceeds ${writeP95BudgetMs}ms`);
}
if (!cleanup.attempted || cleanup.status !== 204 || cleanup.error) {
  failures.push(`synthetic tenant cleanup failed (${cleanup.status ?? cleanup.error ?? 'not attempted'})`);
}

const result = {
  schemaVersion: 1,
  kind: 'trackflow.authenticated-api',
  generatedAt: new Date().toISOString(),
  evidence: {
    scope: 'local-synthetic',
    productionClaim: false,
    note: 'Single API process and local PostgreSQL/Redis; excludes network, hosted pooler, and multi-replica effects.',
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
    target,
    readRequests,
    writeRequests,
    concurrency,
    warmupRequests,
    budgets: { readP95Ms: readP95BudgetMs, writeP95Ms: writeP95BudgetMs, maxErrorRate },
  },
  measurements: { read, write },
  cleanup,
  failures,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    read: read && { p50Ms: read.latencyMs.p50, p95Ms: read.latencyMs.p95, p99Ms: read.latencyMs.p99, rps: read.throughputPerSecond, errors: read.errors },
    write: write && { p50Ms: write.latencyMs.p50, p95Ms: write.latencyMs.p95, p99Ms: write.latencyMs.p99, rps: write.throughputPerSecond, errors: write.errors },
    cleanup,
    failures,
  }),
);
if (failures.length > 0) process.exitCode = 1;
