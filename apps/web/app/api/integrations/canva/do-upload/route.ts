import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

/**
 * POST /api/integrations/canva/do-upload
 *
 * Canva Connect API PPTX import flow:
 *   1. POST /rest/v1/imports with raw binary + Import-Metadata header → get jobId
 *   2. Poll GET /rest/v1/imports/{jobId} → wait for edit URL
 */
export async function POST(request: NextRequest) {
  try {
    const { presentationId, t } = await request.json();

    if (!presentationId || !t) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const accessToken = Buffer.from(t, "base64url").toString();
    if (!accessToken) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }

    const presentation = await prisma.presentation.findFirst({
      where: { id: presentationId },
      include: { project: true },
    });

    if (!presentation?.s3Key) {
      return NextResponse.json({ error: "Presentation not found" }, { status: 404 });
    }

    // Step 1: Download PPTX from S3
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
    const pptxRes = await fetch(downloadUrl);
    if (!pptxRes.ok) throw new Error("Failed to download PPTX from storage");
    const pptxBytes = await pptxRes.arrayBuffer();

    logger.info({ size: pptxBytes.byteLength, presentationId }, "PPTX downloaded for Canva import");

    // Step 2: POST binary directly to /rest/v1/imports
    // Canva expects Content-Type: application/octet-stream with metadata in Import-Metadata header
    const title = presentation.title || "SlideForge Presentation";
    const importMetadata = Buffer.from(JSON.stringify({ title })).toString("base64");

    const createRes = await fetch("https://api.canva.com/rest/v1/imports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
        "Import-Metadata": importMetadata,
      },
      body: pptxBytes,
    });

    if (!createRes.ok) {
      const txt = await createRes.text();
      logger.error({ status: createRes.status, body: txt }, "Canva import create failed");
      return NextResponse.json({ error: `Failed to create Canva import: ${txt}` }, { status: 502 });
    }

    const createData = await createRes.json();
    const jobId = createData.job?.id;

    logger.info({ jobId }, "Canva import job created, polling for completion");

    if (!jobId) {
      logger.error({ createData }, "No jobId in Canva response");
      return NextResponse.json({ error: "No job ID returned from Canva" }, { status: 502 });
    }

    // Step 3: Poll for import completion (max ~30 s)
    let editUrl: string | null = null;
    let designId: string | null = null;

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await fetch(`https://api.canva.com/rest/v1/imports/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!statusRes.ok) continue;

      const s = await statusRes.json();
      const status = s.job?.status;

      logger.info({ jobId, status, i }, "Canva import poll");

      if (status === "success") {
        designId = s.job?.result?.design?.id;
        editUrl =
          s.job?.result?.design?.urls?.edit_url ||
          (designId ? `https://www.canva.com/design/${designId}/edit` : null);
        break;
      }
      if (status === "failed") {
        const reason = JSON.stringify(s.job?.error || s);
        return NextResponse.json({ error: `Canva import failed: ${reason}` }, { status: 502 });
      }
    }

    if (!editUrl) {
      return NextResponse.json({ error: "Canva import timed out — try again" }, { status: 504 });
    }

    if (designId) {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { canvaDesignId: designId },
      }).catch(() => {});
    }

    logger.info({ designId, editUrl }, "Canva design ready");
    return NextResponse.json({ editUrl });
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Canva do-upload error");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
