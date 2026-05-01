import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const session = await getRequiredSession();
    const sf = await prisma.sourceFile.findUnique({ where: { id } });
    if (!sf || sf.userId !== session.user.id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Cascade deletes slide_index rows via FK.
    await prisma.sourceFile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete source file");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
