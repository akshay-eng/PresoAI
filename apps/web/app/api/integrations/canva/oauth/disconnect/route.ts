import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

export async function POST() {
  try {
    const session = await getRequiredSession();

    await prisma.oAuthAccount.deleteMany({
      where: { userId: session.user.id, provider: "canva" },
    });

    return NextResponse.json({ disconnected: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
