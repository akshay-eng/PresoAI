import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

/**
 * GET /api/files — list all presentations across all projects for the current user.
 */
export async function GET() {
  try {
    const session = await getRequiredSession();

    const presentations = await prisma.presentation.findMany({
      where: {
        project: { userId: session.user.id },
        s3Key: { not: "" },
      },
      include: {
        project: { select: { id: true, name: true, prompt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(presentations);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
