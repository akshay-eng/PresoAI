import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getRequiredSession();

    const canvaAccount = await prisma.oAuthAccount.findFirst({
      where: { userId: session.user.id, provider: "canva" },
      select: { id: true, expiresAt: true, scope: true, createdAt: true },
    });

    return NextResponse.json({
      connected: !!canvaAccount,
      expiresAt: canvaAccount?.expiresAt ?? null,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
