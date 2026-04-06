import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { createLLMConfigSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = createLLMConfigSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { apiKey, ...rest } = parsed.data;
    let apiKeyEnc: string | null = null;

    if (apiKey) {
      apiKeyEnc = encrypt(apiKey);
    }

    const config = await prisma.lLMConfig.create({
      data: {
        ...rest,
        apiKeyEnc,
        userId: session.user.id,
      },
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        baseUrl: true,
        temperature: true,
        maxTokens: true,
        isDefault: true,
        userId: true,
      },
    });

    logger.info({ configId: config.id }, "LLM config created");
    return NextResponse.json(config, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to create LLM config");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
