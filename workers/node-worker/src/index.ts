import { Worker } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { processNodeWorkerJob } from "./services/pptx-generator";
import { processFinalizeJob } from "./services/finalizer";
import type { NodeWorkerJobData, FinalizeJobData } from "@slideforge/queue";

const logger = pino({ name: "node-worker" });

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const concurrency = parseInt(process.env.NODE_WORKER_CONCURRENCY || "5", 10);

const nodeWorker = new Worker<NodeWorkerJobData>(
  "ppt-node-worker",
  async (job) => {
    logger.info({ jobId: job.data.jobId }, "Processing PPTX generation job");
    return processNodeWorkerJob(job.data);
  },
  {
    connection,
    concurrency,
    limiter: {
      max: concurrency,
      duration: 1000,
    },
  }
);

const finalizeWorker = new Worker<FinalizeJobData>(
  "ppt-finalize",
  async (job) => {
    logger.info({ jobId: job.data.jobId }, "Processing finalize job");
    return processFinalizeJob(job.data);
  },
  {
    connection,
    concurrency: 3,
  }
);

nodeWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "PPTX generation completed");
});

nodeWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "PPTX generation failed");
});

finalizeWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Finalize completed");
});

finalizeWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, "Finalize failed");
});

logger.info({ concurrency }, "Node worker started");

async function shutdown() {
  logger.info("Shutting down workers...");
  await nodeWorker.close();
  await finalizeWorker.close();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
