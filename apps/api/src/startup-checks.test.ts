import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSecureConfig } from './startup-checks.js';

describe('assertSecureConfig', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.INGEST_SINK_TOKEN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('no-ops outside production even with dev-default secrets', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('throws in production when secrets are left at their dev defaults', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertSecureConfig()).toThrow(/default dev secret/i);
  });

  it('passes in production once strong secrets are set', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.INGEST_SINK_TOKEN = 'c'.repeat(40);
    expect(() => assertSecureConfig()).not.toThrow();
  });
});
