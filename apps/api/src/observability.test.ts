import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import { reportError } from './observability.js';

describe('requestLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  function app() {
    const a = new Hono<AppEnv>();
    a.use('*', requestLogger);
    a.get('/x', (c) => c.text('ok'));
    a.get('/health', (c) => c.text('ok'));
    return a;
  }

  it('adds an x-request-id header and logs structured context', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await app().request('/x');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ level: 'info', method: 'GET', path: '/x', status: 200 });
    expect(line.requestId).toBeTruthy();
    expect(typeof line.ms).toBe('number');
  });

  it('echoes an incoming x-request-id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await app().request('/x', { headers: { 'x-request-id': 'req-123' } });
    expect(res.headers.get('x-request-id')).toBe('req-123');
  });

  it('does not log for /health', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await app().request('/health');
    expect(log).not.toHaveBeenCalled();
  });
});

describe('reportError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('structured-logs the error with context', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError(new Error('boom'), { tenantId: 't1', requestId: 'r1' });
    const line = JSON.parse(err.mock.calls.at(-1)![0] as string);
    expect(line).toMatchObject({ level: 'error', message: 'boom', tenantId: 't1', requestId: 'r1' });
    expect(line.stack).toContain('boom');
  });

  it('coerces non-Error values', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportError('plain string');
    const line = JSON.parse(err.mock.calls.at(-1)![0] as string);
    expect(line.message).toBe('plain string');
  });
});
