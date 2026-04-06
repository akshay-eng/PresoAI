import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * GET /api/llm/models
 *
 * Returns models filtered by user's configured providers:
 * - No API keys configured (free tier) → only Google/Gemini models
 * - Has API keys → only models from configured providers + user's custom models
 */
export async function GET() {
  try {
    const session = await getRequiredSession();

    // Get user's configured provider keys
    const userKeys = await prisma.providerApiKey.findMany({
      where: { userId: session.user.id, isValid: true },
      select: { provider: true },
    });

    const configuredProviders = userKeys.map((k) => k.provider);
    const hasOwnKeys = configuredProviders.length > 0;

    // Determine which providers to show
    let allowedProviders: string[];

    if (!hasOwnKeys) {
      // Free tier: only Gemini models
      allowedProviders = ["google"];
    } else {
      // Show models for configured providers only
      allowedProviders = configuredProviders;
    }

    // Fetch models filtered by provider
    const models = await prisma.lLMConfig.findMany({
      where: {
        OR: [
          // Default models matching allowed providers
          { userId: null, provider: { in: allowedProviders } },
          // User's custom models (always shown)
          { userId: session.user.id },
        ],
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
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({
      models,
      configuredProviders: allowedProviders,
      isFreeTier: !hasOwnKeys,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to list models");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
