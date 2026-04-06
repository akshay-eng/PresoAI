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

    const config = await prisma.lLMConfig.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!config) {
      return NextResponse.json({ error: "Config not found" }, { status: 404 });
    }

    await prisma.lLMConfig.delete({ where: { id } });

    logger.info({ configId: id }, "LLM config deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete LLM config");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
