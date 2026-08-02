import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSecureConfig } from './startup-checks.js';

describe('assertSecureConfig', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.INGEST_SINK_TOKEN;
    delete process.env.DATABASE_URL;
    delete process.env.SYSTEM_DATABASE_URL;
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
    process.env.DATABASE_URL = 'postgres://tenant:secret@db/trackflow';
    process.env.SYSTEM_DATABASE_URL = 'postgres://system:secret@db/trackflow';
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('rejects missing or reused production database identities', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
    process.env.INGEST_SINK_TOKEN = 'c'.repeat(40);
    process.env.DATABASE_URL = 'postgres://runtime:secret@db/trackflow';
    expect(() => assertSecureConfig()).toThrow(/distinct DATABASE_URL and SYSTEM_DATABASE_URL/);
    process.env.SYSTEM_DATABASE_URL = process.env.DATABASE_URL;
    expect(() => assertSecureConfig()).toThrow(/must be distinct/);
  });
});
