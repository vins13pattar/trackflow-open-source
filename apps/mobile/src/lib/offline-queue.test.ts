import { describe, expect, it } from 'vitest';
import { OfflineQueue, type QueuedReport } from './offline-queue';
import { MemoryStorage } from './storage';

function makeReport(ts: number): QueuedReport {
  return { deviceId: 'd1', latitude: 12.97, longitude: 77.59, speedKph: 30, course: 90, timestamp: ts };
}

describe('OfflineQueue', () => {
  it('persists enqueued reports across reads', async () => {
    const store = new MemoryStorage();
    const q = new OfflineQueue(store);
    await q.enqueue(makeReport(1));
    await q.enqueue(makeReport(2));
    const items = await q.read();
    expect(items).toHaveLength(2);
    expect(items[0]!.timestamp).toBe(1);
    expect(items[1]!.timestamp).toBe(2);
  });

  it('returns the right size', async () => {
    const q = new OfflineQueue(new MemoryStorage());
    expect(await q.size()).toBe(0);
    await q.enqueue(makeReport(1));
    await q.enqueue(makeReport(2));
    expect(await q.size()).toBe(2);
  });

  it('caps the queue, dropping the oldest entry', async () => {
    const q = new OfflineQueue(new MemoryStorage(), { maxEntries: 3 });
    await q.enqueue(makeReport(1));
    await q.enqueue(makeReport(2));
    await q.enqueue(makeReport(3));
    await q.enqueue(makeReport(4));
    const items = await q.read();
    expect(items.map((r) => r.timestamp)).toEqual([2, 3, 4]);
  });

  it('flushes FIFO and reports the count', async () => {
    const q = new OfflineQueue(new MemoryStorage());
    await q.enqueue(makeReport(1));
    await q.enqueue(makeReport(2));
    await q.enqueue(makeReport(3));
    const seen: number[] = [];
    const result = await q.flush(async (r) => { seen.push(r.timestamp); });
    expect(result).toEqual({ sent: 3, remaining: 0 });
    expect(seen).toEqual([1, 2, 3]);
    expect(await q.size()).toBe(0);
  });

  it('stops flushing on the first failure and leaves the rest queued', async () => {
    const q = new OfflineQueue(new MemoryStorage());
    await q.enqueue(makeReport(1));
    await q.enqueue(makeReport(2));
    await q.enqueue(makeReport(3));
    let calls = 0;
    const result = await q.flush(async () => {
      calls += 1;
      if (calls === 2) throw new Error('network down');
    });
    expect(result.sent).toBe(1);
    expect(result.remaining).toBe(2);
    const items = await q.read();
    expect(items.map((r) => r.timestamp)).toEqual([2, 3]);
  });

  it('clear empties the queue and removes the storage row', async () => {
    const store = new MemoryStorage();
    const q = new OfflineQueue(store, { storageKey: 'k' });
    await q.enqueue(makeReport(1));
    expect(await store.getItem('k')).not.toBeNull();
    await q.clear();
    expect(await store.getItem('k')).toBeNull();
    expect(await q.size()).toBe(0);
  });

  it('tolerates corrupt JSON in storage and starts fresh', async () => {
    const store = new MemoryStorage();
    await store.setItem('trackflow.offline-queue.v1', '{not json');
    const q = new OfflineQueue(store);
    expect(await q.read()).toEqual([]);
    await q.enqueue(makeReport(1));
    expect(await q.size()).toBe(1);
  });

  it('flush() returns zero-zero on an empty queue without invoking sender', async () => {
    const q = new OfflineQueue(new MemoryStorage());
    let calls = 0;
    const result = await q.flush(async () => { calls += 1; });
    expect(result).toEqual({ sent: 0, remaining: 0 });
    expect(calls).toBe(0);
  });
});
