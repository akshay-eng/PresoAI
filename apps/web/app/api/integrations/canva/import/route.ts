import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

const canvaImportSchema = z.object({
  presentationId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = canvaImportSchema.safeParse(body);

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

    const canvaClientId = process.env.CANVA_CLIENT_ID;
    const canvaClientSecret = process.env.CANVA_CLIENT_SECRET;

    if (!canvaClientId || !canvaClientSecret) {
      return NextResponse.json(
        { error: "Canva integration not configured" },
        { status: 400 }
      );
    }

    // Download the PPTX
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
    const pptxResponse = await fetch(downloadUrl);
    const pptxBlob = await pptxResponse.blob();

    // Upload as asset to Canva
    const formData = new FormData();
    formData.append("file", pptxBlob, `${presentation.title}.pptx`);

    const assetResponse = await fetch(
      "https://api.canva.com/rest/v1/asset-uploads",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${canvaClientSecret}`,
        },
        body: formData,
      }
    );

    if (!assetResponse.ok) {
      const errText = await assetResponse.text();
      logger.error({ error: errText }, "Canva asset upload failed");
      return NextResponse.json(
        { error: "Failed to upload to Canva" },
        { status: 502 }
      );
    }

    const assetResult = await assetResponse.json();

    // Create a design from the asset
    const designResponse = await fetch(
      "https://api.canva.com/rest/v1/designs",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${canvaClientSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          design_type: "presentation",
          asset_id: assetResult.asset?.id,
          title: presentation.title,
        }),
      }
    );

    if (!designResponse.ok) {
      const errText = await designResponse.text();
      logger.error({ error: errText }, "Canva design creation failed");
      return NextResponse.json(
        { error: "Failed to create Canva design" },
        { status: 502 }
      );
    }

    const designResult = await designResponse.json();

    // Update presentation with Canva design ID
    await prisma.presentation.update({
      where: { id: presentation.id },
      data: { canvaDesignId: designResult.design?.id },
    });

    logger.info(
      { presentationId: presentation.id, designId: designResult.design?.id },
      "Canva design created"
    );

    return NextResponse.json({
      editUrl: designResult.design?.edit_url,
      designId: designResult.design?.id,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Canva import failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
