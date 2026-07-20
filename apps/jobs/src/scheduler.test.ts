import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduler, runTask } from './scheduler.js';

describe('runTask', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs ok on success', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTask({ name: 'x', intervalMs: 1, run: async () => undefined });
    expect(JSON.parse(log.mock.calls.at(-1)![0] as string)).toMatchObject({ job: 'x', status: 'ok' });
  });

  it('isolates failures: logs and never throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      runTask({
        name: 'x',
        intervalMs: 1,
        run: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBeUndefined();
    expect(JSON.parse(err.mock.calls.at(-1)![0] as string)).toMatchObject({ job: 'x', status: 'failed', message: 'boom' });
  });
});

describe('createScheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs each task on its own interval until stopped', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);

    const scheduler = createScheduler([
      { name: 'a', intervalMs: 1000, run: a },
      { name: 'b', intervalMs: 5000, run: b },
    ]);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(a).toHaveBeenCalledTimes(5);
    expect(b).toHaveBeenCalledTimes(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a).toHaveBeenCalledTimes(5); // no further ticks after stop
    expect(b).toHaveBeenCalledTimes(1);
  });
});
