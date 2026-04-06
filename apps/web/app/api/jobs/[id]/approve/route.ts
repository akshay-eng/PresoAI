import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { approveJobSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = approveJobSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const job = await prisma.job.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "AWAITING_REVIEW") {
      return NextResponse.json(
        { error: "Job is not awaiting review" },
        { status: 400 }
      );
    }

    const resumeValue = {
      approved: parsed.data.approved,
      edits: parsed.data.editedOutline || [],
      feedback: parsed.data.feedback || "",
    };

    // Call Python agent to resume the LangGraph thread
    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    const resumeResponse = await fetch(`${pythonAgentUrl}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id: job.langGraphThreadId,
        job_id: job.id,
        resume_value: resumeValue,
      }),
    });

    if (!resumeResponse.ok) {
      const errorText = await resumeResponse.text();
      logger.error({ jobId: id, error: errorText }, "Failed to resume agent");
      return NextResponse.json(
        { error: "Failed to resume agent" },
        { status: 500 }
      );
    }

    await prisma.job.update({
      where: { id },
      data: {
        status: parsed.data.approved ? "PROCESSING" : "CANCELLED",
        currentPhase: parsed.data.approved ? "outline_approved" : "cancelled",
      },
    });

    logger.info(
      { jobId: id, approved: parsed.data.approved },
      "Job review submitted"
    );

    return NextResponse.json({
      success: true,
      approved: parsed.data.approved,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to approve job");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
