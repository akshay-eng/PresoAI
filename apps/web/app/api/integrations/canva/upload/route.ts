import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

const schema = z.object({
  presentationId: z.string().min(1),
});

/**
 * POST /api/integrations/canva/upload
 *
 * Uploads a PPTX to Canva via the Connect API and returns the edit URL.
 * Requires CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in env.
 *
 * Flow:
 * 1. Get presigned URL for the PPTX from MinIO
 * 2. Download the PPTX binary
 * 3. Upload to Canva as an asset
 * 4. Create an import job from the asset
 * 5. Poll until the import is complete
 * 6. Return the design edit URL
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const canvaToken = process.env.CANVA_ACCESS_TOKEN;
    if (!canvaToken) {
      return NextResponse.json(
        { error: "Canva is not configured. Set CANVA_ACCESS_TOKEN in your environment." },
        { status: 400 }
      );
    }

    // Get the presentation
    const presentation = await prisma.presentation.findFirst({
      where: { id: parsed.data.presentationId },
      include: { project: true },
    });

    if (!presentation || presentation.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Presentation not found" }, { status: 404 });
    }

    if (!presentation.s3Key) {
      return NextResponse.json({ error: "No PPTX file available" }, { status: 400 });
    }

    // Step 1: Download the PPTX from MinIO
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
    const pptxResponse = await fetch(downloadUrl);
    if (!pptxResponse.ok) throw new Error("Failed to download PPTX from storage");
    const pptxBuffer = await pptxResponse.arrayBuffer();
    const pptxBytes = new Uint8Array(pptxBuffer);

    logger.info({ size: pptxBytes.length }, "PPTX downloaded for Canva upload");

    // Step 2: Upload to Canva as an asset
    const boundary = `----Preso${Date.now()}`;
    const fileName = `${presentation.title || "presentation"}.pptx`;
    const contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    // Build multipart body manually
    const metadataPart = `--${boundary}\r\nContent-Disposition: form-data; name="asset_upload"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name_base: fileName })}\r\n`;
    const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    const endBoundary = `\r\n--${boundary}--\r\n`;

    const encoder = new TextEncoder();
    const metaBytes = encoder.encode(metadataPart);
    const fileHeaderBytes = encoder.encode(filePart);
    const endBytes = encoder.encode(endBoundary);

    const multipartBody = new Uint8Array(metaBytes.length + fileHeaderBytes.length + pptxBytes.length + endBytes.length);
    multipartBody.set(metaBytes, 0);
    multipartBody.set(fileHeaderBytes, metaBytes.length);
    multipartBody.set(pptxBytes, metaBytes.length + fileHeaderBytes.length);
    multipartBody.set(endBytes, metaBytes.length + fileHeaderBytes.length + pptxBytes.length);

    const uploadRes = await fetch("https://api.canva.com/rest/v1/asset-uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${canvaToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      logger.error({ status: uploadRes.status, body: errText }, "Canva asset upload failed");
      return NextResponse.json({ error: `Canva upload failed: ${errText}` }, { status: 502 });
    }

    const uploadResult = await uploadRes.json();
    const assetId = uploadResult.job?.id || uploadResult.id;
    logger.info({ assetId }, "Asset uploaded to Canva");

    // Step 3: Create an import job
    const importRes = await fetch("https://api.canva.com/rest/v1/imports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${canvaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        import_source: { type: "asset_upload", asset_upload_job_id: assetId },
        title: presentation.title || "Preso Presentation",
      }),
    });

    if (!importRes.ok) {
      const errText = await importRes.text();
      logger.error({ body: errText }, "Canva import failed");
      return NextResponse.json({ error: `Canva import failed: ${errText}` }, { status: 502 });
    }

    const importResult = await importRes.json();
    const importJobId = importResult.job?.id || importResult.id;

    // Step 4: Poll for completion (max 30 seconds)
    let editUrl: string | null = null;
    let designId: string | null = null;

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await fetch(`https://api.canva.com/rest/v1/imports/${importJobId}`, {
        headers: { Authorization: `Bearer ${canvaToken}` },
      });

      if (!statusRes.ok) continue;

      const statusResult = await statusRes.json();
      const status = statusResult.job?.status || statusResult.status;

      if (status === "completed" || status === "success") {
        designId = statusResult.job?.result?.design?.id || statusResult.design?.id;
        editUrl = statusResult.job?.result?.design?.urls?.edit_url
          || statusResult.design?.urls?.edit_url
          || (designId ? `https://www.canva.com/design/${designId}/edit` : null);
        break;
      }

      if (status === "failed") {
        return NextResponse.json({ error: "Canva import failed" }, { status: 502 });
      }
    }

    if (!editUrl) {
      // Fallback: if we have a design ID, construct the URL
      if (designId) {
        editUrl = `https://www.canva.com/design/${designId}/edit`;
      } else {
        return NextResponse.json({ error: "Canva import timed out" }, { status: 504 });
      }
    }

    // Save the Canva design ID
    if (designId) {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { canvaDesignId: designId },
      });
    }

    logger.info({ designId, editUrl }, "Canva design created");

    return NextResponse.json({ editUrl, designId });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Canva upload failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
