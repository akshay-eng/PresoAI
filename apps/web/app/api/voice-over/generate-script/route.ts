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

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();

    const { provider, model, project_name, global_context, narrative_goals, video_url } = body as {
      provider: string;
      model: string;
      project_name: string;
      global_context: string;
      narrative_goals: unknown[];
      video_url?: string;
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
    const upstream = await fetch(`${WAVEENGINE_URL}/api/tts/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_name,
        global_context,
        narrative_goals: narrative_goals ?? [],
        ...(video_url ? { video_url } : {}),
        ai_config: {
          provider: mappedProvider,
          model,
          api_key: apiKey,
        },
      }),
    });

    // Stream the upstream response body directly to avoid buffering issues
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
