import { commandWakeupChannel, type CommandWakeup } from '@trackflow/shared';
import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';
import { startCommandWakeupSubscriber } from './command-router.js';
import { closeRedisClient } from './redis.js';

const enabled = !!process.env.TF_REDIS_TESTS;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe.skipIf(!enabled)('Redis command wake-up integration', () => {
  afterAll(closeRedisClient);

  it('delivers only a valid message targeted to this ingest instance', async () => {
    const message: CommandWakeup = {
      version: 1,
      instanceId: 'ingest-test-1',
      imei: '865432019876543',
      deviceId: '11111111-1111-4111-8111-111111111111',
      commandId: '22222222-2222-4222-8222-222222222222',
    };
    let resolveWakeup!: (message: CommandWakeup) => void;
    const received = new Promise<CommandWakeup>((resolve) => {
      resolveWakeup = resolve;
    });
    const stop = await startCommandWakeupSubscriber(resolveWakeup, {
      url: redisUrl,
      instanceId: message.instanceId,
    });
    const publisher = createClient({ url: redisUrl });
    await publisher.connect();
    await publisher.publish(commandWakeupChannel(message.instanceId), JSON.stringify(message));

    await expect(received).resolves.toEqual(message);

    await stop();
    await publisher.quit();
  });
});
