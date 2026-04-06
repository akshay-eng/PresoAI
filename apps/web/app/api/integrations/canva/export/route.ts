import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { s3Client, BUCKET } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "@/lib/logger";

const canvaExportSchema = z.object({
  presentationId: z.string().min(1),
  designId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = canvaExportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const presentation = await prisma.presentation.findFirst({
      where: { id: parsed.data.presentationId },
      include: { project: true },
    });

    if (!presentation || presentation.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Presentation not found" }, { status: 404 });
    }

    const canvaClientSecret = process.env.CANVA_CLIENT_SECRET;
    if (!canvaClientSecret) {
      return NextResponse.json(
        { error: "Canva integration not configured" },
        { status: 400 }
      );
    }

    // Request export from Canva
    const exportResponse = await fetch(
      `https://api.canva.com/rest/v1/designs/${parsed.data.designId}/export`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${canvaClientSecret}`,
        },
      }
    );

    if (!exportResponse.ok) {
      const errText = await exportResponse.text();
      logger.error({ error: errText }, "Canva export failed");
      return NextResponse.json(
        { error: "Failed to export from Canva" },
        { status: 502 }
      );
    }

    const exportResult = await exportResponse.json();
    const exportUrl = exportResult.export?.url;

    if (!exportUrl) {
      return NextResponse.json(
        { error: "No export URL returned from Canva" },
        { status: 502 }
      );
    }

    // Download the exported PPTX
    const pptxResponse = await fetch(exportUrl);
    const pptxBuffer = Buffer.from(await pptxResponse.arrayBuffer());

    // Upload to S3 as new version
    const existingVersions = await prisma.presentation.count({
      where: { projectId: presentation.projectId },
    });

    const newS3Key = `generated/${presentation.projectId}/canva-export-${Date.now()}/presentation.pptx`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: newS3Key,
        Body: pptxBuffer,
        ContentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );

    // Create new Presentation version
    const newPresentation = await prisma.presentation.create({
      data: {
        projectId: presentation.projectId,
        title: `${presentation.title} (Canva Export)`,
        s3Key: newS3Key,
        slideCount: presentation.slideCount,
        version: existingVersions + 1,
        canvaDesignId: parsed.data.designId,
        metadata: { source: "canva_export" },
      },
    });

    logger.info(
      { presentationId: newPresentation.id },
      "Canva export saved"
    );

    return NextResponse.json({
      presentationId: newPresentation.id,
      downloadUrl: newS3Key,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Canva export failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
