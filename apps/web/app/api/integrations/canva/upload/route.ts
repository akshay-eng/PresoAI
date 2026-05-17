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
 * Uploads a PPTX to Canva via the Connect API (OAuth2) and returns the edit URL.
 * Requires the user to have connected their Canva account via /api/integrations/canva/oauth/authorize.
 *
 * Flow:
 * 1. Get user's Canva access token from OAuthAccount
 * 2. Download the PPTX binary from MinIO
 * 3. Upload to Canva as an asset (multipart form)
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

    // Retrieve the user's Canva OAuth token
    const canvaAccount = await prisma.oAuthAccount.findFirst({
      where: { userId: session.user.id, provider: "canva" },
      orderBy: { updatedAt: "desc" },
    });

    let canvaToken = canvaAccount?.accessToken;

    // Refresh if expired
    if (canvaAccount && canvaAccount.expiresAt && canvaAccount.expiresAt < new Date() && canvaAccount.refreshToken) {
      try {
        const refreshRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: process.env.CANVA_CLIENT_ID!,
            client_secret: process.env.CANVA_CLIENT_SECRET!,
            refresh_token: canvaAccount.refreshToken,
          }).toString(),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          canvaToken = data.access_token;
          await prisma.oAuthAccount.update({
            where: { id: canvaAccount.id },
            data: {
              accessToken: data.access_token,
              refreshToken: data.refresh_token ?? canvaAccount.refreshToken,
              expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
            },
          });
        }
      } catch (err) {
        logger.warn({ err }, "Canva token refresh failed — trying with existing token");
      }
    }

    if (!canvaToken) {
      return NextResponse.json(
        { error: "Canva account not connected. Please connect via Settings → Integrations." },
        { status: 401 }
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

    // Step 2: Upload to Canva as an asset (multipart)
    const boundary = `----Preso${Date.now()}`;
    const fileName = `${presentation.title || "presentation"}.pptx`;
    const contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    const encoder = new TextEncoder();
    const metadataPart = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="asset_upload"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name_base: fileName })}\r\n`
    );
    const fileHeader = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`
    );
    const endBoundary = encoder.encode(`\r\n--${boundary}--\r\n`);

    const multipartBody = new Uint8Array(
      metadataPart.length + fileHeader.length + pptxBytes.length + endBoundary.length
    );
    multipartBody.set(metadataPart, 0);
    multipartBody.set(fileHeader, metadataPart.length);
    multipartBody.set(pptxBytes, metadataPart.length + fileHeader.length);
    multipartBody.set(endBoundary, metadataPart.length + fileHeader.length + pptxBytes.length);

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
    const assetJobId = uploadResult.job?.id || uploadResult.id;
    logger.info({ assetJobId }, "Asset upload job created in Canva");

    // Step 3: Create an import job
    const importRes = await fetch("https://api.canva.com/rest/v1/imports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${canvaToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        import_source: { type: "asset_upload", asset_upload_job_id: assetJobId },
        title: presentation.title || "SlideForge Presentation",
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
        editUrl =
          statusResult.job?.result?.design?.urls?.edit_url ||
          statusResult.design?.urls?.edit_url ||
          (designId ? `https://www.canva.com/design/${designId}/edit` : null);
        break;
      }

      if (status === "failed") {
        return NextResponse.json({ error: "Canva import failed" }, { status: 502 });
      }
    }

    if (!editUrl) {
      editUrl = designId ? `https://www.canva.com/design/${designId}/edit` : null;
      if (!editUrl) return NextResponse.json({ error: "Canva import timed out" }, { status: 504 });
    }

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
