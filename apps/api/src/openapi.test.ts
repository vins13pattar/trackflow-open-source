import { describe, expect, it } from 'vitest';
import { openapi } from './openapi.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** Collect every operation across `paths` with its method, path, and the operation object. */
function operations(): Array<{ method: string; path: string; op: Record<string, unknown> }> {
  const out: Array<{ method: string; path: string; op: Record<string, unknown> }> = [];
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const [k, v] of Object.entries(item)) {
      if (HTTP_METHODS.has(k)) out.push({ method: k, path, op: v as Record<string, unknown> });
    }
  }
  return out;
}

/** Walks a JSON value and yields every `$ref` string it finds. */
function* refs(value: unknown): IterableIterator<string> {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) yield* refs(v);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '$ref' && typeof v === 'string') yield v;
    else yield* refs(v);
  }
}

describe('OpenAPI spec', () => {
  it('declares OpenAPI 3.1 and the four security schemes', () => {
    expect(openapi.openapi).toBe('3.1.0');
    const names = Object.keys(openapi.components.securitySchemes);
    expect(names.sort()).toEqual(['adminAuth', 'apiKeyAuth', 'bearerAuth', 'ingestAuth']);
  });

  it('every operation has a tag, summary, and at least one response', () => {
    for (const { method, path, op } of operations()) {
      const where = `${method.toUpperCase()} ${path}`;
      expect(op.tags, where).toBeDefined();
      expect((op.tags as string[]).length, where).toBeGreaterThan(0);
      expect(op.summary, where).toBeTypeOf('string');
      expect(op.responses, where).toBeDefined();
      expect(Object.keys(op.responses as object).length, where).toBeGreaterThan(0);
    }
  });

  it('every $ref points at a component that exists', () => {
    const known = new Set<string>([
      ...Object.keys(openapi.components.schemas).map((n) => `#/components/schemas/${n}`),
      ...Object.keys(openapi.components.responses).map((n) => `#/components/responses/${n}`),
    ]);
    for (const r of refs(openapi)) expect(known, r).toContain(r);
  });

  it('only references security schemes that the components declare', () => {
    const declared = new Set(Object.keys(openapi.components.securitySchemes));
    const visit = (sec: unknown): void => {
      if (!Array.isArray(sec)) return;
      for (const entry of sec) {
        if (entry && typeof entry === 'object') {
          for (const name of Object.keys(entry as Record<string, unknown>)) {
            expect(declared, name).toContain(name);
          }
        }
      }
    };
    visit(openapi.security);
    for (const { op } of operations()) visit(op.security);
  });

  it('covers every public router (no obvious gaps)', () => {
    const expected = ['/auth/login', '/devices', '/geofences', '/alerts', '/analytics/summary', '/webhooks', '/billing/subscription', '/users', '/api-keys', '/branding', '/admin/plans', '/internal/positions', '/health'];
    for (const p of expected) expect(openapi.paths, p).toHaveProperty(p);
  });
});
