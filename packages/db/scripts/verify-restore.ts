import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { RLS_TABLES } from '../src/rls.js';

/**
 * Restore-drill verifier. Run this AFTER restoring a Neon Point-In-Time branch
 * into a scratch database, to confirm the restore is coherent before trusting
 * it. It is read-only and exits non-zero if any check fails.
 *
 * Neon PITR restore drill (manual ops steps — can't be done from this sandbox):
 *   1. In the Neon console: project → Branches → Restore, or
 *        neonctl branches create --parent <branch> --timestamp <ISO8601>
 *      This creates a *scratch* branch at the target time. Never restore in
 *      place over production.
 *   2. Copy the scratch branch's connection string.
 *   3. Run the verifier against it:
 *        ADMIN_DATABASE_URL=<scratch-url> pnpm --filter @trackflow/db db:verify-restore
 *   4. PASS → the branch is sound (promote it / repoint the app). FAIL → choose
 *      a different timestamp and repeat.
 *
 * Schedule this drill quarterly and record the date + result in the runbook.
 */

const url =
  process.env.ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://trackflow:trackflow@localhost:5432/trackflow';

const sql = postgres(url, { max: 1 });

const results: { name: string; ok: boolean; detail: string }[] = [];
async function safe(name: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  try {
    const r = await fn();
    results.push({ name, ...r });
  } catch (e) {
    results.push({ name, ok: false, detail: `error: ${(e as Error).message}` });
  }
}

// 1. Migrations applied up to the committed HEAD.
await safe('migrations at HEAD', async () => {
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url)), 'utf8'),
  ) as { entries: unknown[] };
  const expected = journal.entries.length;
  const [row] = await sql<{ applied: number }[]>`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`;
  const applied = row?.applied ?? 0;
  return { ok: applied >= expected, detail: `${applied}/${expected} applied` };
});

// 2. Core + latest-migration tables present.
await safe('required tables present', async () => {
  const required = ['tenants', 'users', 'sessions', 'auth_tokens', 'devices', 'positions', 'trips', 'daily_rollups', 'invoices', 'webhooks'];
  const rows = await sql<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
  const present = new Set(rows.map((r) => r.table_name));
  const missing = required.filter((t) => !present.has(t));
  return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : `${required.length} present` };
});

// 3. RLS enabled on every tenant-scoped table.
await safe('RLS enabled on tenant tables', async () => {
  const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity FROM pg_class WHERE relkind IN ('r', 'p')`;
  const byName = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
  const problems = RLS_TABLES.filter((t) => byName.get(t) !== true);
  return { ok: problems.length === 0, detail: problems.length ? `RLS off/absent: ${problems.join(', ')}` : `${RLS_TABLES.length} tables` };
});

// 4. positions remains partitioned with at least the DEFAULT partition.
await safe('positions partitioned', async () => {
  const [k] = await sql<{ relkind: string }[]>`SELECT relkind FROM pg_class WHERE relname='positions'`;
  const [p] = await sql<{ parts: number }[]>`SELECT count(*)::int AS parts FROM pg_inherits WHERE inhparent='positions'::regclass`;
  return { ok: k?.relkind === 'p' && (p?.parts ?? 0) >= 1, detail: `relkind=${k?.relkind ?? 'none'}, partitions=${p?.parts ?? 0}` };
});

await sql.end();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`[db] restore verification FAILED (${failed.length}/${results.length} checks failed)`);
  process.exit(1);
}
console.log(`[db] restore verification PASSED (${results.length}/${results.length} checks)`);
process.exit(0);
