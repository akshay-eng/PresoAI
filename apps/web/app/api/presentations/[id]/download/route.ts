import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const presentation = await prisma.presentation.findFirst({
      where: { id },
      include: { project: true },
    });

    if (!presentation || presentation.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!presentation.s3Key) {
      return NextResponse.json({ error: "No file available" }, { status: 404 });
    }

    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key, 600);

    return NextResponse.json({ downloadUrl, fileName: `${presentation.title}.pptx` });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
