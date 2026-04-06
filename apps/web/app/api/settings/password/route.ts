import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hash, compare } from "bcryptjs";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Account uses OAuth — no password to change" }, { status: 400 });
    }

    const valid = await compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }

    const newHash = await hash(parsed.data.newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
