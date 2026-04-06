import type IORedis from "ioredis";
import { createRedisConnection } from "./connection";
import type { ProgressEvent } from "./types";

export const PROGRESS_CHANNEL_PREFIX = "job:";
export const PROGRESS_CHANNEL_SUFFIX = ":progress";

function getChannelName(jobId: string): string {
  return `${PROGRESS_CHANNEL_PREFIX}${jobId}${PROGRESS_CHANNEL_SUFFIX}`;
}

export async function publishProgress(
  jobId: string,
  event: ProgressEvent,
  redis?: IORedis
): Promise<void> {
  const client = redis ?? createRedisConnection();
  try {
    await client.publish(getChannelName(jobId), JSON.stringify(event));
  } finally {
    if (!redis) {
      client.disconnect();
    }
  }
}

export async function subscribeProgress(
  jobId: string,
  callback: (event: ProgressEvent) => void,
  redis?: IORedis
): Promise<{ unsubscribe: () => Promise<void> }> {
  const subscriber = redis ?? createRedisConnection();
  const channel = getChannelName(jobId);

  subscriber.on("message", (_ch: string, message: string) => {
    try {
      const event = JSON.parse(message) as ProgressEvent;
      callback(event);
    } catch {
      // ignore malformed messages
    }
  });

  await subscriber.subscribe(channel);

  return {
    unsubscribe: async () => {
      await subscriber.unsubscribe(channel);
      subscriber.disconnect();
    },
  };
}
