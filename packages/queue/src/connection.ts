import IORedis from "ioredis";

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

export const connection = createRedisConnection();
