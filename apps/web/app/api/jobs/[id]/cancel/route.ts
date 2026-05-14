/**
 * POST /api/jobs/[id]/cancel
 *
 * Best-effort cancel for an in-flight generation/edit job. Flips the job
 * status in Postgres to FAILED with a "cancelled by user" reason and pushes
 * a "failed" progress event over Redis so the UI's SSE listener tears down
 * the active panel.
 *
 * NOTE: this does NOT yank the running LLM call. The python worker keeps
 * running (LangGraph nodes aren't preemptible mid-flight). What we get:
 *   - UI immediately stops polling and shows a cancelled state
 *   - The worker's eventual completion writes to a row whose status is
 *     already FAILED → the worker's project-deleted guard already handles
 *     missing-row gracefully, so a similar guard could be added for
 *     cancelled rows. For now the worker's S3 upload is wasted; the UI is
 *     responsive which is what matters for UX.
 */
import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    // Verify ownership.
    const job = await prisma.job.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, status: true, projectId: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status === "COMPLETED" || job.status === "FAILED") {
      return NextResponse.json({ ok: true, alreadyTerminal: true });
    }

    // Mark FAILED with a cancellation reason.
    await prisma.job.update({
      where: { id },
      data: {
        status: "FAILED",
        currentPhase: "failed",
        error: "Cancelled by user",
        completedAt: new Date(),
      },
    });

    // Publish the failed event so the SSE listener tears down immediately.
    const redis = new Redis(REDIS_URL);
    try {
      await redis.publish(
        `job:${id}:progress`,
        JSON.stringify({
          phase: "failed",
          progress: 1.0,
          message: "Cancelled by user",
          data: {
            errorCode: "cancelled",
            errorTitle: "Cancelled",
            errorMessage: "You stopped this generation.",
            errorHint: "Re-prompt to start fresh.",
            errorRetryable: true,
          },
        }),
      );
    } finally {
      await redis.quit();
    }

    logger.info({ jobId: id, userId: session.user.id }, "Job cancelled by user");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to cancel job");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
