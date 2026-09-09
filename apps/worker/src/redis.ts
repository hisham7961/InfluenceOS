import IORedis from 'ioredis';

export function redisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

/** BullMQ requires maxRetriesPerRequest: null on the shared connection. */
export function createConnection(): IORedis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: false });
}

/** Best-effort check that Redis is reachable (so we can fall back gracefully). */
export async function isRedisAvailable(): Promise<boolean> {
  const client = new IORedis(redisUrl(), {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    return pong === 'PONG';
  } catch {
    client.disconnect();
    return false;
  }
}
