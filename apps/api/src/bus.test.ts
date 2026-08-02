import { describe, expect, it } from 'vitest';
import { BoundedEventQueue } from './bounded-event-queue.js';
import { type PositionEvent, RealtimeBus, type RealtimeBroker } from './bus.js';

class MemoryBroker implements RealtimeBroker {
  private readonly subscribers = new Set<(message: string) => void>();

  async publish(message: string): Promise<void> {
    for (const subscriber of this.subscribers) subscriber(message);
  }

  async subscribe(onMessage: (message: string) => void): Promise<() => Promise<void>> {
    this.subscribers.add(onMessage);
    return async () => {
      this.subscribers.delete(onMessage);
    };
  }

  inject(message: string): void {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}

const position: PositionEvent = {
  deviceId: 'device-a',
  imei: '111111111111111',
  lat: 19.076,
  lon: 72.8777,
  speedKph: 32,
  course: 90,
  fixTime: '2026-08-02T00:00:00.000Z',
  kind: 'location',
};

describe('RealtimeBus', () => {
  it('fans out across replicas without duplicating the publisher echo', async () => {
    const broker = new MemoryBroker();
    const replicaA = new RealtimeBus(broker);
    const replicaB = new RealtimeBus(broker);
    const seenA: PositionEvent[] = [];
    const seenB: PositionEvent[] = [];
    replicaA.subscribePositions('tenant-a', (event) => seenA.push(event));
    replicaB.subscribePositions('tenant-a', (event) => seenB.push(event));
    await Promise.all([replicaA.ready(), replicaB.ready()]);

    await replicaA.publishPosition('tenant-a', position);

    expect(seenA).toEqual([position]);
    expect(seenB).toEqual([position]);
    await Promise.all([replicaA.close(), replicaB.close()]);
  });

  it('does not deliver one tenant’s events to another tenant', async () => {
    const broker = new MemoryBroker();
    const replica = new RealtimeBus(broker);
    const seen: PositionEvent[] = [];
    replica.subscribePositions('tenant-b', (event) => seen.push(event));
    await replica.ready();
    await replica.publishPosition('tenant-a', position);
    expect(seen).toEqual([]);
    await replica.close();
  });

  it('ignores malformed broker messages', async () => {
    const broker = new MemoryBroker();
    const replica = new RealtimeBus(broker);
    const seen: PositionEvent[] = [];
    replica.subscribePositions('tenant-a', (event) => seen.push(event));
    await replica.ready();
    broker.inject('{not-json');
    broker.inject(JSON.stringify({ version: 1, sourceId: 'remote', tenantId: 'tenant-a', kind: 'unknown', event: position }));
    expect(seen).toEqual([]);
    await replica.close();
  });
});

describe('BoundedEventQueue', () => {
  it('bounds a slow consumer without dropping another queue', async () => {
    const slow = new BoundedEventQueue<number>(2);
    const healthy = new BoundedEventQueue<number>(2);
    expect(slow.push(1)).toBe(true);
    expect(slow.push(2)).toBe(true);
    expect(slow.push(3)).toBe(false);
    expect(healthy.push(9)).toBe(true);
    expect(await healthy.next(10)).toBe(9);
    expect(await slow.next(10)).toBe(1);
    expect(await slow.next(10)).toBe(2);
  });
});
