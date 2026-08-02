import { commandWakeupChannel, commandWakeupSchema, type CommandWakeup } from '@trackflow/shared';
import type { RedisClientType } from 'redis';
import { env } from './env.js';
import { redisClient } from './redis.js';

export async function startCommandWakeupSubscriber(
  onWakeup: (message: CommandWakeup) => void | Promise<void>,
  options: { url?: string; instanceId?: string } = {},
): Promise<() => Promise<void>> {
  const url = options.url ?? env.redisUrl;
  if (!url) return async () => {};
  const instanceId = options.instanceId ?? env.instanceId;
  const subscriber = (await redisClient(url)).duplicate() as RedisClientType;
  subscriber.on('error', (error) => console.error('[ingest:commands] subscriber error', error));
  await subscriber.connect();
  const channel = commandWakeupChannel(instanceId);
  await subscriber.subscribe(channel, (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = commandWakeupSchema.safeParse(parsed);
    if (!result.success || result.data.instanceId !== instanceId) return;
    void Promise.resolve(onWakeup(result.data)).catch((error) =>
      console.warn('[ingest:commands] wake-up failed:', (error as Error).message),
    );
  });
  return async () => {
    if (subscriber.isOpen) {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    }
  };
}
