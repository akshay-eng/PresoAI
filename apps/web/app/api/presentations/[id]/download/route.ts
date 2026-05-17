import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const format = request.nextUrl.searchParams.get("format") ?? "pptx";

    const presentation = await prisma.presentation.findFirst({
      where: { id },
      include: { project: true },
    });

    if (!presentation || presentation.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (format === "pdf") {
      if (!presentation.pdfS3Key) {
        return NextResponse.json(
          { error: "PDF not available for this presentation. Re-generate to enable PDF download." },
          { status: 404 }
        );
      }
      const downloadUrl = await getPresignedDownloadUrl(presentation.pdfS3Key, 600);
      const fileName = `${presentation.title}.pdf`;
      prisma.downloadEvent.create({
        data: {
          userId: session.user.id,
          presentationId: presentation.id,
          projectId: presentation.projectId,
          fileName,
        },
      }).catch(() => { /* non-fatal */ });
      return NextResponse.json({ downloadUrl, fileName });
    }

    if (!presentation.s3Key) {
      return NextResponse.json({ error: "No file available" }, { status: 404 });
    }

    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key, 600);
    const fileName = `${presentation.title}.pptx`;

    // Log for admin analytics — fire-and-forget, never block download.
    prisma.downloadEvent.create({
      data: {
        userId: session.user.id,
        presentationId: presentation.id,
        projectId: presentation.projectId,
        fileName,
      },
    }).catch(() => { /* non-fatal */ });

    return NextResponse.json({ downloadUrl, fileName });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
