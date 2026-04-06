import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@slideforge/db";
import { registerSchema } from "@slideforge/shared";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, name, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hash(password, 12);
    const user = await prisma.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });

    logger.info({ userId: user.id }, "User registered");
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    logger.error({ error: (err as Error).message }, "Registration failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
