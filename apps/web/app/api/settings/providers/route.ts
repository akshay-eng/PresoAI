import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

const providerSchema = z.object({
  provider: z.enum(["google", "anthropic", "openai", "mistral"]),
  apiKey: z.string().min(1),
});

// Provider validation endpoints
const VALIDATION_CONFIGS: Record<string, { url: string; headers: (key: string) => Record<string, string>; method: string; body?: string }> = {
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?key=",
    headers: () => ({}),
    method: "GET",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }),
    method: "POST",
    body: JSON.stringify({ model: "claude-haiku-4-20250414", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    method: "GET",
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    method: "GET",
  },
};

// GET — list user's provider keys (without exposing actual keys)
export async function GET() {
  try {
    const session = await getRequiredSession();

    const keys = await prisma.providerApiKey.findMany({
      where: { userId: session.user.id },
      select: { id: true, provider: true, isValid: true, lastValidated: true, createdAt: true },
    });

    return NextResponse.json(keys);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — add or update a provider key + validate it
export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = providerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { provider, apiKey } = parsed.data;

    // Validate the key by making a test request
    const config = VALIDATION_CONFIGS[provider];
    let isValid = false;

    if (config) {
      try {
        const url = provider === "google" ? `${config.url}${apiKey}` : config.url;
        const res = await fetch(url, {
          method: config.method,
          headers: config.headers(apiKey),
          ...(config.body ? { body: config.body } : {}),
        });

        // For Anthropic, 200 or 400 (bad request but authenticated) means key is valid
        isValid = res.ok || (provider === "anthropic" && res.status < 500);

        if (!isValid) {
          const errText = await res.text();
          logger.warn({ provider, status: res.status }, "API key validation failed");
          return NextResponse.json({
            error: `Invalid ${provider} API key. Server returned ${res.status}.`,
            valid: false,
          }, { status: 400 });
        }
      } catch (e) {
        return NextResponse.json({ error: `Could not validate ${provider} key: ${(e as Error).message}`, valid: false }, { status: 400 });
      }
    }

    // Encrypt and store
    const apiKeyEnc = encrypt(apiKey);

    await prisma.providerApiKey.upsert({
      where: { userId_provider: { userId: session.user.id, provider } },
      update: { apiKeyEnc, isValid, lastValidated: new Date() },
      create: { userId: session.user.id, provider, apiKeyEnc, isValid, lastValidated: new Date() },
    });

    logger.info({ provider, isValid }, "Provider key saved");

    return NextResponse.json({ provider, isValid, message: `${provider} API key validated and saved!` });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — remove a provider key
export async function DELETE(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const { provider } = await request.json();

    await prisma.providerApiKey.deleteMany({
      where: { userId: session.user.id, provider },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
