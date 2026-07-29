import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

/** Lazy standard-Redis connection shared by API stores. Commands wait for the
 * initial connection, so startup order does not create intermittent failures. */
export async function redisClient(url: string): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (!connecting) {
    client = createClient({ url });
    client.on('error', (error) => console.error('[redis] client error', error));
    connecting = client.connect().then(() => client!);
  }
  try {
    return await connecting;
  } catch (error) {
    connecting = null;
    throw error;
  }
}
