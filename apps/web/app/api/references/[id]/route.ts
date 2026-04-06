import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const ref = await prisma.referenceFile.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    });

    if (!ref || ref.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.referenceFile.delete({ where: { id } });

    logger.info({ referenceId: id }, "Reference file deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete reference");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
