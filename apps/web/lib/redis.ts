import IORedis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: IORedis | undefined;
};

export function getRedis(): IORedis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(
      process.env.REDIS_URL || "redis://localhost:6379",
      {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }
    );
  }
  return globalForRedis.redis;
}

export function createSubscriber(): IORedis {
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
