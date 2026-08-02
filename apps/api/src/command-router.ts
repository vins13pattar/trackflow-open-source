import { commandWakeupChannel, type CommandWakeup } from '@trackflow/shared';
import { env } from './env.js';
import { redisClient } from './redis.js';

export interface CommandPublisher {
  publish(channel: string, message: string): Promise<number>;
}

export class CommandWakeupRouter {
  constructor(private readonly publisher: CommandPublisher | null) {}

  async request(message: CommandWakeup): Promise<boolean> {
    if (!this.publisher) return false;
    const receivers = await this.publisher.publish(commandWakeupChannel(message.instanceId), JSON.stringify(message));
    return receivers > 0;
  }
}

let router: CommandWakeupRouter | null = null;

function commandRouter(): CommandWakeupRouter {
  router ??= new CommandWakeupRouter(
    env.redisUrl
      ? {
          publish: async (channel, message) => (await redisClient(env.redisUrl!)).publish(channel, message),
        }
      : null,
  );
  return router;
}

/** Advisory wake-up only. A false result leaves the durable queued row intact;
 * the ingest session polls it on its next admitted connection. */
export async function requestCommandWakeup(message: CommandWakeup): Promise<boolean> {
  try {
    return await commandRouter().request(message);
  } catch (error) {
    console.warn('[commands] immediate wake-up failed:', (error as Error).message);
    return false;
  }
}
