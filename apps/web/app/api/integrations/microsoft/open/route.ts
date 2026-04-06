import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

const microsoftOpenSchema = z.object({
  presentationId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = microsoftOpenSchema.safeParse(body);

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

    // Get the Microsoft OAuth token for this user
    const oauthAccount = await prisma.oAuthAccount.findFirst({
      where: {
        userId: session.user.id,
        provider: "microsoft-entra-id",
      },
    });

    if (!oauthAccount?.accessToken) {
      return NextResponse.json(
        { error: "Microsoft account not connected. Please sign in with Microsoft." },
        { status: 400 }
      );
    }

    // Download the PPTX from S3
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
    const pptxResponse = await fetch(downloadUrl);
    const pptxBuffer = await pptxResponse.arrayBuffer();

    // Upload to user's OneDrive
    const fileName = `${presentation.title || "Presentation"}.pptx`;
    const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/Preso/${fileName}:/content`;

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${oauthAccount.accessToken}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      body: pptxBuffer,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      logger.error({ error: errText }, "OneDrive upload failed");
      return NextResponse.json(
        { error: "Failed to upload to OneDrive" },
        { status: 502 }
      );
    }

    const uploadResult = await uploadResponse.json();
    const itemId = uploadResult.id;

    // Create sharing link
    const linkResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/createLink`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${oauthAccount.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "edit",
          scope: "organization",
        }),
      }
    );

    let editUrl = uploadResult.webUrl;
    if (linkResponse.ok) {
      const linkResult = await linkResponse.json();
      editUrl = linkResult.link?.webUrl || editUrl;
    }

    logger.info(
      { presentationId: presentation.id },
      "Presentation uploaded to OneDrive"
    );

    return NextResponse.json({ editUrl });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Microsoft integration failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
