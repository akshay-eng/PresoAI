import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const templateSchema = z.object({
  s3Key: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = templateSchema.safeParse(body);

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

    const template = await prisma.template.create({
      data: {
        name: parsed.data.s3Key.split("/").pop() || "Template",
        s3Key: parsed.data.s3Key,
        userId: session.user.id,
        extractionStatus: "processing",
      },
    });

    await prisma.project.update({
      where: { id },
      data: { templateId: template.id },
    });

    const job = await prisma.job.create({
      data: {
        type: "TEMPLATE_EXTRACTION",
        status: "PROCESSING",
        projectId: id,
        userId: session.user.id,
        startedAt: new Date(),
        input: { s3Key: parsed.data.s3Key, templateId: template.id },
      },
    });

    // Call Python agent to extract theme
    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    const extractResponse = await fetch(`${pythonAgentUrl}/extract-theme`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_key: parsed.data.s3Key }),
    });

    if (extractResponse.ok) {
      const result = await extractResponse.json();

      await prisma.template.update({
        where: { id: template.id },
        data: {
          themeConfig: result.theme || {},
          extractionStatus: "done",
        },
      });

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          output: { themeExtracted: true },
        },
      });

      logger.info({ projectId: id, templateId: template.id }, "Template extraction completed");
    } else {
      const errText = await extractResponse.text();
      logger.error({ error: errText }, "Template extraction failed");

      await prisma.template.update({
        where: { id: template.id },
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

    return NextResponse.json({
      templateId: template.id,
      jobId: job.id,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to add template");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
