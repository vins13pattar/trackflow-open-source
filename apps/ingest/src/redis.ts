import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

/** Lazy standard-Redis connection shared by ingest session and presence stores. */
export async function redisClient(url: string): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (!connecting) {
    client = createClient({ url });
    client.on('error', (error) => console.error('[ingest:redis] client error', error));
    connecting = client.connect().then(() => client!);
  }
  try {
    return await connecting;
  } catch (error) {
    connecting = null;
    throw error;
  }
}
