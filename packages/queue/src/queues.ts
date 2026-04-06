import { Queue, FlowProducer } from "bullmq";
import { connection } from "./connection";
import type { PythonAgentJobData, NodeWorkerJobData, FinalizeJobData } from "./types";

export const QUEUE_NAMES = {
  PYTHON_AGENT: "ppt-python-agent",
  NODE_WORKER: "ppt-node-worker",
  FINALIZE: "ppt-finalize",
} as const;

export const pptPythonAgentQueue = new Queue<PythonAgentJobData>(
  QUEUE_NAMES.PYTHON_AGENT,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    },
  }
);

export const pptNodeWorkerQueue = new Queue<NodeWorkerJobData>(
  QUEUE_NAMES.NODE_WORKER,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    },
  }
);

export const pptFinalizeQueue = new Queue<FinalizeJobData>(
  QUEUE_NAMES.FINALIZE,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    },
  }
);

export const flowProducer = new FlowProducer({ connection });
