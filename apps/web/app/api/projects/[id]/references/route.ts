import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const referenceSchema = z.object({
  s3Key: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().positive().optional().default(0),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = referenceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const referenceFile = await prisma.referenceFile.create({
      data: {
        projectId: id,
        fileName: parsed.data.fileName,
        fileType: parsed.data.fileType,
        s3Key: parsed.data.s3Key,
        fileSize: parsed.data.fileSize,
        extractionStatus: "processing",
      },
    });

    const job = await prisma.job.create({
      data: {
        type: "REFERENCE_PROCESSING",
        status: "PROCESSING",
        projectId: id,
        userId: session.user.id,
        startedAt: new Date(),
        input: {
          s3Key: parsed.data.s3Key,
          fileType: parsed.data.fileType,
          referenceFileId: referenceFile.id,
        },
      },
    });

    // Call Python agent to extract reference text
    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    const extractResponse = await fetch(`${pythonAgentUrl}/extract-reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        s3_key: parsed.data.s3Key,
        file_type: parsed.data.fileType,
      }),
    });

    if (extractResponse.ok) {
      const result = await extractResponse.json();

      await prisma.referenceFile.update({
        where: { id: referenceFile.id },
        data: {
          extractedText: result.text || "",
          extractionStatus: "done",
        },
      });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          output: { textLength: (result.text || "").length },
        },
      });

      logger.info(
        { projectId: id, referenceFileId: referenceFile.id },
        "Reference extraction completed"
      );
    } else {
      const errText = await extractResponse.text();
      logger.error({ error: errText }, "Reference extraction failed");

      await prisma.referenceFile.update({
        where: { id: referenceFile.id },
        data: { extractionStatus: "failed" },
      });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: errText,
          completedAt: new Date(),
        },
      });
    }

    // Re-fetch to return current status
    const updated = await prisma.referenceFile.findUnique({
      where: { id: referenceFile.id },
    });

    return NextResponse.json({
      referenceFile: updated,
      jobId: job.id,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to add reference");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
