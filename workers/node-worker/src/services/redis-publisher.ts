import IORedis from "ioredis";
import pino from "pino";
import type { ProgressEvent } from "@slideforge/queue";

const logger = pino({ name: "redis-publisher" });

let publisherClient: IORedis | null = null;

function getPublisher(): IORedis {
  if (!publisherClient) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    publisherClient = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return publisherClient;
}

export async function publishProgress(
  jobId: string,
  event: ProgressEvent
): Promise<void> {
  const client = getPublisher();
  const channel = `job:${jobId}:progress`;
  const payload = JSON.stringify(event);

  try {
    await client.publish(channel, payload);
  } catch (err) {
    logger.error({ jobId, error: (err as Error).message }, "Failed to publish progress");
  }
}
