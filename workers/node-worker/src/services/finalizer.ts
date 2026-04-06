import pino from "pino";
import { prisma } from "@slideforge/db";
import type { FinalizeJobData } from "@slideforge/queue";
import { publishProgress } from "./redis-publisher";

const logger = pino({ name: "finalizer" });

export async function processFinalizeJob(data: FinalizeJobData): Promise<void> {
  const { projectId, jobId, s3Key, thumbnails, slideCount, title } = data;

  try {
    await publishProgress(jobId, {
      phase: "finalizing",
      progress: 0.98,
      message: "Saving presentation record...",
    });

    const existingVersions = await prisma.presentation.count({
      where: { projectId },
    });

    const presentation = await prisma.presentation.create({
      data: {
        projectId,
        title: title || "Untitled Presentation",
        s3Key,
        thumbnails: thumbnails,
        slideCount,
        version: existingVersions + 1,
        jobId: await getJobRecordId(jobId),
      },
    });

    const jobRecord = await prisma.job.findFirst({
      where: { bullmqJobId: jobId },
    });

    if (jobRecord) {
      await prisma.job.update({
        where: { id: jobRecord.id },
        data: {
          status: "COMPLETED",
          progress: 1.0,
          currentPhase: "complete",
          output: {
            s3Key,
            thumbnails,
            slideCount,
            presentationId: presentation.id,
          },
          completedAt: new Date(),
        },
      });
    }

    await publishProgress(jobId, {
      phase: "complete",
      progress: 1.0,
      message: "Presentation saved successfully!",
      data: {
        presentationId: presentation.id,
        s3Key,
        thumbnails,
        slideCount,
      },
    });

    logger.info(
      { jobId, presentationId: presentation.id },
      "Presentation finalized"
    );
  } catch (err) {
    logger.error({ jobId, error: (err as Error).message }, "Finalization failed");

    await publishProgress(jobId, {
      phase: "failed",
      progress: 1.0,
      message: `Finalization failed: ${(err as Error).message}`,
    });

    throw err;
  }
}

async function getJobRecordId(bullmqJobId: string): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: { bullmqJobId: bullmqJobId },
    select: { id: true },
  });
  return job?.id ?? null;
}
