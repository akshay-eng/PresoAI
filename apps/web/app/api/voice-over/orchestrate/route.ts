import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";

// Maps Preso AI provider IDs → WaveEngine provider names
const PROVIDER_MAP: Record<string, string> = {
  anthropic: "claude",
  google: "gemini",
  openai: "openai",
  mistral: "mistral",
};

const WAVEENGINE_URL = process.env.WAVEENGINE_API_URL ?? "http://localhost:8080";

// Allow up to 5 minutes — orchestration (TTS + FFmpeg mix) can take a while
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();

    const { provider, model, script, background_music } = body as {
      provider: string;
      model: string;
      script: unknown;
      background_music?: { track_file_name: string; volume_percent: number } | null;
    };

    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model are required." }, { status: 400 });
    }

    // Retrieve the stored (encrypted) API key for this provider
    const keyRecord = await prisma.providerApiKey.findUnique({
      where: { userId_provider: { userId: session.user.id, provider } },
    });

    if (!keyRecord) {
      return NextResponse.json(
        { error: `No API key configured for '${provider}'. Add one in Settings.` },
        { status: 400 }
      );
    }

    const apiKey = decrypt(keyRecord.apiKeyEnc);
    const mappedProvider = PROVIDER_MAP[provider] ?? provider;

    // Forward to WaveEngine C# backend
    // Response is streamed to avoid buffering large Base64-encoded WAV payloads
    const upstream = await fetch(`${WAVEENGINE_URL}/api/tts/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script,
        ai_config: {
          provider: mappedProvider,
          model,
          api_key: apiKey,
        },
        background_music: background_music ?? null,
      }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
