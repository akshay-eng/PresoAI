import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@slideforge/db";
import { s3Client, BUCKET } from "@/lib/s3";
import { logger } from "@/lib/logger";

/**
 * Sanitize a filename for WOPI's BaseFileName field. Collabora rejects any
 * BaseFileName that looks like a path — that means slashes, but also markdown
 * brackets, parens, colons, and other characters Office filename validation
 * disallows. We strip those and any non-printable / non-ASCII chars, then
 * trim to a sensible length and guarantee non-empty.
 */
function sanitizeBaseFileName(raw: string | null | undefined): string {
  const fallback = "presentation";
  const trimmed = (raw || "").trim();
  if (!trimmed) return fallback;

  // Drop characters that crash Collabora's BaseFileName validation OR
  // make the file look like it has a path (\, /, :, *, ?, ", <, >, |),
  // plus markdown structure ([], (), `, ~) and any non-ASCII / control chars.
  let cleaned = trimmed.replace(/[\\/:*?"<>|\[\]()`~]/g, " ");
  cleaned = cleaned.replace(/[^\x20-\x7E]/g, " ");
  // Collapse whitespace runs and trim.
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  // Hard cap at 80 chars so the eventual filename + .pptx stays inside
  // every filesystem's per-segment limit and Collabora's UI looks sane.
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80).trim();

  return cleaned || fallback;
}

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

  // Get actual file size from S3 via HeadObject — direct SDK call instead of
  // a presigned-URL HEAD, which fails silently on some MinIO configs and
  // would leave Size at 0 (Collabora interprets that as a corrupt file).
  let size = 0;
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: presentation.s3Key })
    );
    size = head.ContentLength ?? 0;
  } catch (err) {
    logger.warn(
      { presentationId: id, error: (err as Error).message },
      "WOPI HeadObject failed; reporting size=0"
    );
  }

  return NextResponse.json({
    BaseFileName: `${sanitizeBaseFileName(presentation.title)}.pptx`,
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
