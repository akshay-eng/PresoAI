/**
 * GET /api/projects/[id]/active-job
 *
 * Returns the most recent job for this project so the UI can resume progress
 * tracking after the user navigates away and comes back (or refreshes, or
 * opens the project in a new tab).
 *
 * Response — three shapes:
 *   { status: "PROCESSING", jobId, currentPhase, progress, lastMessage, ... }
 *     → an in-flight job; UI should attach SSE and render the live panel
 *
 *   { status: "COMPLETED", jobId, presentationId, slideCount, completedAt, ... }
 *     → the most recent completion; UI may show "ready" CTA if it hasn't
 *       acknowledged this jobId yet
 *
 *   { status: null }
 *     → no job has ever been started for this project (cold state)
 *
 * Only returns jobs owned by the signed-in user.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    // Verify ownership cheaply before the join.
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Prefer the most recent NON-terminal job. If there isn't one, fall back
    // to the most recent terminal one so the UI can decide whether to show
    // "ready" / "failed" state vs. a blank panel.
    const inflight = await prisma.job.findFirst({
      where: {
        projectId: id,
        userId: session.user.id,
        status: { notIn: Array.from(TERMINAL) as never[] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        progress: true,
        currentPhase: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        input: true,
      },
    });

    const job =
      inflight ||
      (await prisma.job.findFirst({
        where: { projectId: id, userId: session.user.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          progress: true,
          currentPhase: true,
          startedAt: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          output: true,
          error: true,
          input: true,
        },
      }));

    if (!job) {
      return NextResponse.json({ status: null });
    }

    const inputData = job.input as Record<string, unknown> | null;
    const outputData =
      "output" in job ? ((job as { output?: Record<string, unknown> | null }).output ?? null) : null;

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      isTerminal: TERMINAL.has(job.status as string),
      progress: job.progress ?? 0,
      currentPhase: job.currentPhase ?? "",
      engine: (inputData?.engine as string) ?? null,
      startedAt: job.startedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      completedAt:
        "completedAt" in job
          ? ((job as { completedAt: Date | null }).completedAt?.toISOString() ?? null)
          : null,
      output: outputData,
      error: "error" in job ? ((job as { error: string | null }).error ?? null) : null,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to load active job");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
