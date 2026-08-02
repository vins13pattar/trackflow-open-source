import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYSTEM_ACCESS_REASONS } from './rls.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const inventory = readFileSync(join(repoRoot, 'docs/SYSTEM_ACCESS_INVENTORY.md'), 'utf8');
const productionRoots = ['apps/api/src', 'apps/jobs/src'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [path];
  });
}

describe('privileged system access inventory', () => {
  it('requires every production withSystem call site to use an approved reason and be documented', () => {
    const approved = new Set<string>(SYSTEM_ACCESS_REASONS);
    const callPattern = /withSystem\(\s*[\w.]+\s*,\s*'([^']+)'/g;
    const callSites: Array<{ file: string; reason: string }> = [];

    for (const root of productionRoots) {
      for (const absolute of sourceFiles(join(repoRoot, root))) {
        const source = readFileSync(absolute, 'utf8');
        for (const match of source.matchAll(callPattern)) {
          callSites.push({ file: relative(repoRoot, absolute), reason: match[1]! });
        }
      }
    }

    expect(callSites.length).toBeGreaterThan(0);
    for (const { file, reason } of callSites) {
      expect(approved.has(reason), `${file} uses unapproved reason ${reason}`).toBe(true);
      expect(reason, `${file} must not use the test-only capability`).not.toBe('test-fixture');
      expect(inventory, `${file} is missing from docs/SYSTEM_ACCESS_INVENTORY.md`).toContain(`\`${file}\``);
    }
  });
});
