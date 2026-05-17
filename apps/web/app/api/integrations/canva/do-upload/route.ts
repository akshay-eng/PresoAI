import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

/**
 * POST /api/integrations/canva/do-upload
 *
 * Called by the inline HTML loading page returned by the OAuth callback.
 * Receives the Canva access token directly in the request body (base64url encoded)
 * so we avoid cookie SameSite / redirect ordering issues entirely.
 */
export async function POST(request: NextRequest) {
  try {
    const { presentationId, t } = await request.json();

    if (!presentationId || !t) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    // Decode the base64url token passed from the callback HTML page
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

    // Download PPTX from S3
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
    const pptxRes = await fetch(downloadUrl);
    if (!pptxRes.ok) throw new Error("Failed to download PPTX from storage");
    const pptxBytes = new Uint8Array(await pptxRes.arrayBuffer());

    logger.info({ size: pptxBytes.length, presentationId }, "PPTX downloaded for Canva");

    // Canva Connect API asset upload:
    // PUT raw binary with Asset-Upload-Metadata header (base64-encoded JSON name)
    const fileName = `${presentation.title || "presentation"}.pptx`;
    const metadata = Buffer.from(JSON.stringify({ name_base: fileName })).toString("base64");

    const uploadRes = await fetch("https://api.canva.com/rest/v1/asset-uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Asset-Upload-Metadata": metadata,
      },
      body: pptxBytes,
    });

    if (!uploadRes.ok) {
      const txt = await uploadRes.text();
      logger.error({ status: uploadRes.status, body: txt }, "Canva asset upload failed");
      return NextResponse.json({ error: `Canva upload failed: ${txt}` }, { status: 502 });
    }

    const uploadResult = await uploadRes.json();
    const assetJobId = uploadResult.job?.id || uploadResult.id;
    logger.info({ assetJobId }, "Canva asset upload job started");

    // Create import job
    const importRes = await fetch("https://api.canva.com/rest/v1/imports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        import_source: { type: "asset_upload", asset_upload_job_id: assetJobId },
        title: presentation.title || "SlideForge Presentation",
      }),
    });

    if (!importRes.ok) {
      const txt = await importRes.text();
      logger.error({ body: txt }, "Canva import create failed");
      return NextResponse.json({ error: `Canva import failed: ${txt}` }, { status: 502 });
    }

    const importResult = await importRes.json();
    const importJobId = importResult.job?.id || importResult.id;

    // Poll for completion (max ~20 s)
    let editUrl: string | null = null;
    let designId: string | null = null;

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await fetch(
        `https://api.canva.com/rest/v1/imports/${importJobId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!statusRes.ok) continue;

      const s = await statusRes.json();
      const status = s.job?.status || s.status;

      if (status === "completed" || status === "success") {
        designId = s.job?.result?.design?.id || s.design?.id;
        editUrl =
          s.job?.result?.design?.urls?.edit_url ||
          s.design?.urls?.edit_url ||
          (designId ? `https://www.canva.com/design/${designId}/edit` : null);
        break;
      }
      if (status === "failed") {
        return NextResponse.json({ error: "Canva import job failed" }, { status: 502 });
      }
    }

    if (!editUrl && designId) editUrl = `https://www.canva.com/design/${designId}/edit`;
    if (!editUrl) return NextResponse.json({ error: "Canva import timed out" }, { status: 504 });

    if (designId) {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { canvaDesignId: designId },
      }).catch(() => {});
    }

    logger.info({ designId, editUrl }, "Canva design ready");
    return NextResponse.json({ editUrl });
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Canva do-upload failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
