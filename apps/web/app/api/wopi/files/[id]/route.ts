import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl } from "@/lib/s3";

/**
 * WOPI CheckFileInfo — Collabora/ONLYOFFICE calls this to get file metadata.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const presentation = await prisma.presentation.findFirst({
    where: { id },
    include: { project: { select: { name: true, userId: true } } },
  });

  if (!presentation || !presentation.s3Key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get actual file size from S3
  let size = 0;
  try {
    const url = await getPresignedDownloadUrl(presentation.s3Key);
    const head = await fetch(url, { method: "HEAD" });
    size = parseInt(head.headers.get("content-length") || "0", 10);
  } catch {}

  return NextResponse.json({
    BaseFileName: `${presentation.title || "presentation"}.pptx`,
    Size: size,
    OwnerId: presentation.project.userId,
    UserId: presentation.project.userId,
    UserFriendlyName: "Preso User",
    UserCanWrite: true,
    ReadOnly: false,
    SupportsUpdate: true,
    SupportsLocks: true,
    UserCanNotWriteRelative: true,
  });
}
