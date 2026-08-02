import { afterAll, describe, expect, it } from 'vitest';
import { type PositionEvent, RealtimeBus, RedisRealtimeBroker } from './bus.js';
import { closeRedisClient } from './redis.js';

const enabled = !!process.env.TF_REDIS_TESTS;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const position: PositionEvent = {
  deviceId: 'device-redis',
  imei: '222222222222222',
  lat: 12.9716,
  lon: 77.5946,
  speedKph: 24,
  course: 180,
  fixTime: '2026-08-02T00:00:00.000Z',
  kind: 'location',
};

describe.skipIf(!enabled)('Redis realtime broker integration', () => {
  afterAll(async () => {
    await closeRedisClient();
  });

  it('fans a position from one API replica to another exactly once', async () => {
    const replicaA = new RealtimeBus(new RedisRealtimeBroker(redisUrl));
    const replicaB = new RealtimeBus(new RedisRealtimeBroker(redisUrl));
    let localCount = 0;
    const remoteEvent = new Promise<PositionEvent>((resolve) => {
      replicaB.subscribePositions('tenant-redis', resolve);
    });
    replicaA.subscribePositions('tenant-redis', () => {
      localCount += 1;
    });
    await Promise.all([replicaA.ready(), replicaB.ready()]);

    await replicaA.publishPosition('tenant-redis', position);
    await expect(remoteEvent).resolves.toEqual(position);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(localCount).toBe(1);

    await Promise.all([replicaA.close(), replicaB.close()]);
  });
});
