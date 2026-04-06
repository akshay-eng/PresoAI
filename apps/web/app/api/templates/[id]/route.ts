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

    const template = await prisma.template.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Unlink from any projects using this template
    await prisma.project.updateMany({
      where: { templateId: id },
      data: { templateId: null },
    });

    await prisma.template.delete({ where: { id } });

    logger.info({ templateId: id }, "Template deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete template");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
