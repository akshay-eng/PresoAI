/**
 * GET /v1/llm-configs
 *
 * List the LLM configs available to this account (the user's own + any
 * global defaults). Useful for agents that want to pick a provider without
 * hard-coding model identifiers.
 *
 * Note: API key material is NEVER returned. To use a config in POST /v1/decks
 * either rely on the user's stored provider key OR pass `model.apiKey` in the
 * request body.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { withApiAuth } from "@/lib/v1-auth";

const SUPPORTED_PROVIDERS = ["openai", "anthropic", "google", "mistral"];

export const GET = (request: NextRequest) =>
  withApiAuth({ endpoint: "GET /v1/llm-configs" }, async (_req, auth) => {
    const configs = await prisma.lLMConfig.findMany({
      where: {
        OR: [{ userId: auth.user.id }, { userId: null }],
        provider: { in: SUPPORTED_PROVIDERS },
      },
      orderBy: [{ isDefault: "desc" }, { provider: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        isDefault: true,
      },
    });

    // Tell the agent which providers it has its own stored keys for, so it
    // can pick a config that won't need a body-passed apiKey.
    const providerKeys = await prisma.providerApiKey.findMany({
      where: { userId: auth.user.id, isValid: true },
      select: { provider: true },
    });
    const userProviders = new Set(providerKeys.map((k) => k.provider));

    return NextResponse.json({
      items: configs.map((c) => ({
        ...c,
        userHasProviderKey: userProviders.has(c.provider),
      })),
      supportedProviders: SUPPORTED_PROVIDERS,
    });
  })(request);
