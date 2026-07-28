import { describe, expect, it, vi } from 'vitest';
import { ForwardQueue } from './forward-queue.js';

interface Item {
  device: string;
  value: number;
}

function queue(
  send: (item: Item, signal: AbortSignal) => Promise<void>,
  overrides: Partial<ConstructorParameters<typeof ForwardQueue<Item>>[1]> = {},
) {
  return new ForwardQueue(send, {
    capacity: 4,
    perKeyCapacity: 2,
    concurrency: 1,
    timeoutMs: 50,
    maxAttempts: 2,
    retryBaseMs: 1,
    keyOf: (item) => item.device,
    random: () => 0,
    ...overrides,
  });
}

describe('ForwardQueue', () => {
  it('bounds the queue and isolates a noisy device', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drops: string[] = [];
    const q = queue(async () => blocked, { hooks: { dropped: (reason) => drops.push(reason) } });

    expect(q.enqueue({ device: 'a', value: 1 })).toBe(true);
    expect(q.enqueue({ device: 'a', value: 2 })).toBe(true);
    expect(q.enqueue({ device: 'a', value: 3 })).toBe(false);
    expect(q.enqueue({ device: 'b', value: 4 })).toBe(true);
    expect(drops).toEqual(['per_key_limit']);
    release();
    expect(await q.closeAndDrain(100)).toBe(true);
  });

  it('retries transient failures but not permanent failures', async () => {
    const transient = vi.fn(async () => {
      if (transient.mock.calls.length === 1) throw new Error('temporary');
    });
    const retries: string[] = [];
    const q = queue(transient, {
      classifyError: () => ({ category: 'network', retryable: true }),
      hooks: { retry: (category) => retries.push(category) },
    });
    q.enqueue({ device: 'a', value: 1 });
    expect(await q.closeAndDrain(100)).toBe(true);
    expect(transient).toHaveBeenCalledTimes(2);
    expect(retries).toEqual(['network']);

    const permanent = vi.fn(async () => {
      throw new Error('bad request');
    });
    const q2 = queue(permanent, { classifyError: () => ({ category: 'http_400', retryable: false }) });
    q2.enqueue({ device: 'b', value: 2 });
    expect(await q2.closeAndDrain(100)).toBe(true);
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it('stops accepting and reports a drain timeout predictably', async () => {
    const q = queue(async () => new Promise<void>(() => {}), { timeoutMs: 1_000 });
    expect(q.enqueue({ device: 'a', value: 1 })).toBe(true);
    expect(await q.closeAndDrain(5)).toBe(false);
    expect(q.enqueue({ device: 'b', value: 2 })).toBe(false);
  });
});
