/**
 * GET /v1/jobs/[id]
 *
 * Poll the status of a deck-generation or edit job. Returns the latest known
 * phase, progress, and — once `status` is `succeeded` — a presentationId +
 * downloadUrl that the caller can fetch immediately.
 *
 * Response (200):
 *   {
 *     jobId, deckId, status: "queued"|"processing"|"succeeded"|"failed",
 *     phase, progress, message,
 *     presentationId?, downloadUrl?, slideCount?,
 *     createdAt, completedAt,
 *     error?: { code, message }
 *   }
 *
 * Returns 404 if the job doesn't exist or doesn't belong to the bearer key's user.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { withApiAuth, jsonError } from "@/lib/v1-auth";
import { getPresignedDownloadUrl } from "@/lib/s3";

interface Ctx { params: Promise<{ id: string }> }

export const GET = (request: NextRequest, ctx: Ctx) =>
  withApiAuth({ endpoint: "GET /v1/jobs/[id]" }, async (req, auth) => {
    const { id } = await ctx.params;

    const job = await prisma.job.findFirst({
      where: { id, userId: auth.user.id },
      include: { project: { select: { id: true } } },
    });
    if (!job) {
      return jsonError(404, "job_not_found", "Job not found");
    }
    auth.setJobId(job.id);

    const status = mapStatus(job.status);
    const out = (job.output as Record<string, unknown> | null) || null;
    let presentationId: string | undefined;
    let downloadUrl: string | undefined;
    let slideCount: number | undefined;

    if (status === "succeeded") {
      // Find the latest presentation for this project. (BullMQ stores
      // presentationId in job.output but we re-derive defensively.)
      const presentation = await prisma.presentation.findFirst({
        where: { projectId: job.projectId },
        orderBy: { version: "desc" },
        select: { id: true, s3Key: true, slideCount: true },
      });
      if (presentation) {
        presentationId = presentation.id;
        slideCount = presentation.slideCount;
        try {
          // 1-hour presigned URL — agents typically download immediately.
          downloadUrl = await getPresignedDownloadUrl(presentation.s3Key, 3600);
        } catch {
          /* fall through — caller can hit /v1/decks/[id]/download to retry */
        }
      }
    }

    const errorBody =
      status === "failed"
        ? { code: typeof out?.errorCode === "string" ? out.errorCode : "generation_failed",
            message: job.error || (typeof out?.message === "string" ? out.message : "Generation failed") }
        : undefined;

    return NextResponse.json({
      jobId: job.id,
      deckId: job.projectId,
      status,
      phase: job.currentPhase || (status === "queued" ? "queued" : null),
      progress: job.progress ?? 0,
      message: typeof out?.message === "string" ? out.message : null,
      presentationId,
      downloadUrl,
      slideCount,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      ...(errorBody ? { error: errorBody } : {}),
    });
  })(request);

function mapStatus(s: string): "queued" | "processing" | "succeeded" | "failed" {
  switch (s) {
    case "PENDING":
    case "QUEUED":
      return "queued";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
      return "succeeded";
    case "FAILED":
    case "CANCELLED":
      return "failed";
    default:
      return "processing";
  }
}
