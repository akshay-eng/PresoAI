import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

    const userScopedPrefixes = [
      `uploads/general/${userId}/`,
      `uploads/chat-image/${userId}/`,
      `uploads/template/${userId}/`,
      `uploads/reference/${userId}/`,
      `uploads/find-source/${userId}/`,
    ];

    let owned = userScopedPrefixes.some((p) => key.startsWith(p));

    if (!owned) {
      const [u, t, r, s, sp] = await Promise.all([
        prisma.userUpload.findFirst({ where: { s3Key: key, userId } }),
        prisma.template.findFirst({ where: { s3Key: key, userId } }),
        prisma.referenceFile.findFirst({ where: { s3Key: key, project: { userId } } }),
        prisma.sourceFile.findFirst({ where: { s3Key: key, userId } }),
        prisma.styleProfileSource.findFirst({ where: { s3Key: key, styleProfile: { userId } } }),
      ]);
      owned = !!(u || t || r || s || sp);
    }

    if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signedUrl = await getPresignedDownloadUrl(key, 600);
    return NextResponse.json({ url: signedUrl });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ err: (err as Error).message }, "Failed to sign download URL");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
