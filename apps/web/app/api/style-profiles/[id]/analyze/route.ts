import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

const analyzeSchema = z.object({
  modelId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = analyzeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const profile = await prisma.styleProfile.findFirst({
      where: { id, userId: session.user.id },
      include: { sourceFiles: true },
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (profile.sourceFiles.length === 0) {
      return NextResponse.json(
        { error: "No source files added to this profile" },
        { status: 400 }
      );
    }

    // Get the LLM config for multimodal analysis
    const llmConfig = await prisma.lLMConfig.findUnique({
      where: { id: parsed.data.modelId },
    });

    if (!llmConfig) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    let apiKey: string | undefined;
    if (llmConfig.apiKeyEnc) {
      try {
        apiKey = decrypt(llmConfig.apiKeyEnc);
      } catch {
        apiKey = undefined;
      }
    }

    // Update status to analyzing
    await prisma.styleProfile.update({
      where: { id },
      data: { status: "analyzing" },
    });

    // Call Python agent's /analyze-style endpoint
    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    const response = await fetch(`${pythonAgentUrl}/analyze-style`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        style_profile_id: id,
        user_id: session.user.id,
        source_files: profile.sourceFiles.map((sf) => ({
          source_id: sf.id,
          s3_key: sf.s3Key,
          file_name: sf.fileName,
        })),
        model_config_dict: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          base_url: llmConfig.baseUrl,
          api_key: apiKey,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ profileId: id, error: errText }, "Style analysis failed");
      await prisma.styleProfile.update({
        where: { id },
        data: { status: "failed" },
      });
      return NextResponse.json(
        { error: "Style analysis failed" },
        { status: 502 }
      );
    }

    const result = await response.json();

    // Save the analysis results to the profile
    await prisma.styleProfile.update({
      where: { id },
      data: {
        status: "ready",
        visualStyle: result.visual_style || undefined,
        styleGuide: result.style_guide || undefined,
        themeConfig: result.theme_config || undefined,
        layoutPatterns: result.layout_patterns || undefined,
      },
    });

    logger.info({ profileId: id }, "Style analysis complete");

    return NextResponse.json({
      profileId: id,
      status: "ready",
      styleGuide: result.style_guide,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to analyze style");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
