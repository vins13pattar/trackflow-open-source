// Minimal dependency-free load test for the ingest write path.
// Usage: TARGET=... N=1000 CONCURRENCY=100 IMEI=... node loadtest/run.mjs
const TARGET = process.env.TARGET ?? 'http://127.0.0.1:8787';
const N = Number(process.env.N ?? 500);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const IMEI = process.env.IMEI ?? '865432019876543';
const TOKEN = process.env.INGEST_TOKEN ?? 'dev-ingest-token-change-me';

const body = () =>
  JSON.stringify({
    imei: IMEI,
    protocol: 'gt06',
    latitude: 12.97 + Math.random() * 0.05,
    longitude: 77.59 + Math.random() * 0.05,
    speedKph: Math.random() * 60,
    course: Math.random() * 360,
    gpsValid: true,
    fixTime: Date.now(),
    kind: 'location',
  });

const latencies = [];
let errors = 0;
let sent = 0;
const start = Date.now();

async function one() {
  const t = performance.now();
  try {
    const res = await fetch(`${TARGET}/internal/positions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
      body: body(),
    });
    if (!res.ok && res.status !== 202) errors++;
    await res.text();
  } catch {
    errors++;
  }
  latencies.push(performance.now() - t);
}

let i = 0;
async function worker() {
  while (i < N) {
    i++;
    sent++;
    await one();
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(1);
const secs = (Date.now() - start) / 1000;
console.log(
  `requests=${sent} errors=${errors} throughput=${(sent / secs).toFixed(0)}/s ` +
    `p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`,
);

// CI gate: set P95_BUDGET_MS to fail (exit 1) when p95 regresses past the budget
// or the error rate exceeds MAX_ERROR_RATE. Without a budget this is just a benchmark.
const budgetMs = Number(process.env.P95_BUDGET_MS ?? 0);
if (budgetMs > 0) {
  const p95 = Number(pct(95));
  const errorRate = sent ? errors / sent : 0;
  const maxErrorRate = Number(process.env.MAX_ERROR_RATE ?? 0.01);
  const reasons = [];
  if (p95 > budgetMs) reasons.push(`p95 ${p95}ms > budget ${budgetMs}ms`);
  if (errorRate > maxErrorRate) reasons.push(`error rate ${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%`);
  if (reasons.length) {
    console.error(`LOADTEST FAIL: ${reasons.join('; ')}`);
    process.exit(1);
  }
  console.log(`LOADTEST PASS: p95 ${p95}ms <= ${budgetMs}ms, errors ${(errorRate * 100).toFixed(2)}% <= ${(maxErrorRate * 100).toFixed(2)}%`);
}
