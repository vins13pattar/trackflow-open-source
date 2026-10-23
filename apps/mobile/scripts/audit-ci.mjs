#!/usr/bin/env node
// `npm audit --audit-level high` with a narrow, documented exception list.
//
// npm has no equivalent of pnpm's `auditConfig.ignoreGhsas`, so the gate is
// applied here instead: run the audit, drop findings that reduce entirely to
// allowlisted advisories, and fail on anything left. Exceptions are listed one
// GHSA at a time in audit-exceptions.json, so a *new* unpatchable advisory
// still fails CI and gets a decision rather than passing silently.
//
// npm reports a finding per affected package, so a single unpatchable advisory
// shows up once at its root and again for every package that depends on it.
// A finding is excepted only when every advisory reachable from it is
// allowlisted; one unexcepted advisory anywhere in its `via` graph fails it.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ignoreGhsas } = JSON.parse(
  readFileSync(join(packageRoot, 'audit-exceptions.json'), 'utf8'),
);
const allowed = new Set(Object.keys(ignoreGhsas));

// `npm audit` exits non-zero when it finds anything, so the status is expected.
let raw;
try {
  raw = execFileSync('npm', ['audit', '--json'], { cwd: packageRoot, encoding: 'utf8' });
} catch (error) {
  if (!error.stdout) throw error;
  raw = error.stdout;
}
const { vulnerabilities } = JSON.parse(raw);

const ghsaOf = (url) => url.split('/').pop();

/** Every advisory reachable from a finding, following `via` through dependents. */
function advisoriesFor(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const finding = vulnerabilities[name];
  if (!finding) return [];
  return finding.via.flatMap((via) =>
    typeof via === 'string' ? advisoriesFor(via, seen) : [ghsaOf(via.url)],
  );
}

const blocking = [];
const excepted = [];
for (const [name, finding] of Object.entries(vulnerabilities)) {
  if (!BLOCKING.has(finding.severity)) continue;
  const advisories = [...new Set(advisoriesFor(name))];
  // An empty set means npm gave us no advisory to judge; treat that as blocking
  // rather than quietly passing it.
  const target = advisories.length > 0 && advisories.every((id) => allowed.has(id))
    ? excepted
    : blocking;
  target.push({ name, severity: finding.severity, advisories });
}

for (const { name, severity, advisories } of excepted) {
  console.log(`ignored  ${severity.padEnd(8)} ${name} (${advisories.join(', ')})`);
}
for (const { name, severity, advisories } of blocking) {
  console.error(`BLOCKING ${severity.padEnd(8)} ${name} (${advisories.join(', ') || 'no advisory id'})`);
}

const counts = Object.values(vulnerabilities).reduce((acc, { severity }) => {
  acc[severity] = (acc[severity] ?? 0) + 1;
  return acc;
}, {});
const summary = Object.entries(counts)
  .map(([severity, count]) => `${count} ${severity}`)
  .join(' | ');
console.log(`\n${summary || 'no vulnerabilities'} (${excepted.length} ignored)`);

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} high/critical finding(s) with no exception. Raise the version, ` +
      'or add the advisory to audit-exceptions.json and SECURITY.md if no patch exists.',
  );
  process.exit(1);
}
