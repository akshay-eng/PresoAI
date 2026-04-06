import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl, s3Client, BUCKET } from "@/lib/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * GET — ONLYOFFICE calls this to download the file content.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const presentation = await prisma.presentation.findFirst({
    where: { id },
  });

  if (!presentation || !presentation.s3Key) {
    return new Response("Not found", { status: 404 });
  }

  const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key);
  const fileRes = await fetch(downloadUrl);

  if (!fileRes.ok) {
    return new Response("Failed to fetch file", { status: 502 });
  }

  const buffer = await fileRes.arrayBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${presentation.title || "presentation"}.pptx"`,
    },
  });
}

/**
 * POST — ONLYOFFICE callback. Sends JSON with status and optionally a URL to the saved file.
 *
 * ONLYOFFICE callback format:
 * { "key": "...", "status": 2, "url": "http://onlyoffice/cache/...", "users": [...] }
 *
 * Status codes:
 * 1 = being edited (no action needed)
 * 2 = ready for saving (download from url and save)
 * 6 = being edited but save requested (forcesave)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const status = body.status;

    // Status 1 = being edited, just acknowledge
    if (status === 1) {
      return NextResponse.json({ error: 0 });
    }

    // Status 2 or 6 = save the file
    if ((status === 2 || status === 6) && body.url) {
      const presentation = await prisma.presentation.findFirst({
        where: { id },
      });

      if (!presentation || !presentation.s3Key) {
        return NextResponse.json({ error: 0 });
      }

      // Download the edited file from ONLYOFFICE's cache
      const fileRes = await fetch(body.url);
      if (fileRes.ok) {
        const buffer = Buffer.from(await fileRes.arrayBuffer());

        // Upload back to MinIO
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: presentation.s3Key,
            Body: buffer,
            ContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          })
        );
      }
    }

    // ONLYOFFICE expects {"error": 0} on success
    return NextResponse.json({ error: 0 });
  } catch {
    return NextResponse.json({ error: 0 });
  }
}
