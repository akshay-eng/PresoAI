import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { generatePresentationSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = generatePresentationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      include: {
        template: true,
        referenceFiles: {
          where: { extractionStatus: "done" },
        },
        styleProfile: true,
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if user has their own API keys
    const userKeys = await prisma.providerApiKey.findMany({
      where: { userId: session.user.id, isValid: true },
      select: { provider: true },
    });
    const hasOwnKeys = userKeys.length > 0;

    // Coupon-redeemed users skip free tier limits and ride on the server's
    // default Gemini key (resolved via env vars further down).
    const userRow = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { couponCode: true },
    });
    const hasCoupon = !!userRow?.couponCode;

    // If no own keys AND no coupon, enforce free tier limit
    if (!hasOwnKeys && !hasCoupon) {
      let freeTier = await prisma.freeTierSession.findUnique({
        where: { userId: session.user.id },
      });

      if (!freeTier) {
        freeTier = await prisma.freeTierSession.create({
          data: { userId: session.user.id, generationsUsed: 0, maxGenerations: 1, windowHours: 8 },
        });
      }

      // Check if window expired — reset
      const windowEnd = new Date(freeTier.windowStart.getTime() + freeTier.windowHours * 60 * 60 * 1000);
      const now = new Date();

      if (now > windowEnd) {
        freeTier = await prisma.freeTierSession.update({
          where: { userId: session.user.id },
          data: { generationsUsed: 0, windowStart: now },
        });
      }

      if (freeTier.generationsUsed >= freeTier.maxGenerations) {
        const resetTime = new Date(freeTier.windowStart.getTime() + freeTier.windowHours * 60 * 60 * 1000);
        const msLeft = resetTime.getTime() - Date.now();
        const hoursLeft = Math.floor(msLeft / 3600000);
        const minsLeft = Math.floor((msLeft % 3600000) / 60000);
        const timeStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;

        return NextResponse.json({
          error: `Free tier limit reached. Try again in ${timeStr}, or add your own API key in Settings.`,
          rateLimited: true,
          resetAt: resetTime.toISOString(),
          timeLeft: timeStr,
        }, { status: 429 });
      }

      // Increment usage
      await prisma.freeTierSession.update({
        where: { userId: session.user.id },
        data: { generationsUsed: { increment: 1 } },
      });
    }

    const llmConfig = await prisma.lLMConfig.findUnique({
      where: { id: parsed.data.modelId },
    });

    if (!llmConfig) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    // Resolve API key: user's provider key > LLM config key > server env (free tier)
    let apiKey: string | undefined;
    let keySource: "user_key" | "free_tier" = "free_tier";

    // First check if user has a provider key for this model's provider
    const userProviderKey = await prisma.providerApiKey.findUnique({
      where: { userId_provider: { userId: session.user.id, provider: llmConfig.provider } },
    });

    let userKeyDecryptFailed = false;
    if (userProviderKey?.apiKeyEnc) {
      try {
        apiKey = decrypt(userProviderKey.apiKeyEnc);
        keySource = "user_key";
      } catch (err) {
        // Likely a stored key encrypted with an old ENCRYPTION_KEY (key
        // rotation, etc.). Silently falling through would dispatch a job
        // with no api_key and fail downstream — surface it to the user.
        userKeyDecryptFailed = true;
        logger.error(
          { err: (err as Error).message, provider: llmConfig.provider, userId: session.user.id },
          "Stored provider API key failed to decrypt"
        );
      }
    }

    // Fall back to LLM config's own key (for custom models)
    if (!apiKey && llmConfig.apiKeyEnc) {
      try {
        apiKey = decrypt(llmConfig.apiKeyEnc);
        keySource = "user_key";
      } catch (err) {
        logger.error(
          { err: (err as Error).message, modelId: llmConfig.id },
          "LLMConfig api_key failed to decrypt"
        );
      }
    }

    // For non-google providers we MUST have a usable key — server only has a
    // default GOOGLE_API_KEY (free tier). Refuse the job clearly so the user
    // can re-enter the key in Settings rather than seeing a Pydantic crash
    // from the python-agent.
    if (!apiKey && llmConfig.provider !== "google") {
      const msg = userKeyDecryptFailed
        ? `Your stored ${llmConfig.provider} API key could not be decrypted (likely from before a key rotation). Re-add it in Settings → API Keys.`
        : `No ${llmConfig.provider} API key configured. Add one in Settings → API Keys, or pick a Gemini model.`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // If no key for google specifically, the server env GOOGLE_API_KEY will be used by python-agent.

    const langGraphThreadId = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const job = await prisma.job.create({
      data: {
        type: "PPT_GENERATION",
        status: "PROCESSING",
        projectId: id,
        userId: session.user.id,
        langGraphThreadId,
        startedAt: new Date(),
        input: {
          prompt: parsed.data.prompt,
          numSlides: parsed.data.numSlides,
          audienceType: parsed.data.audienceType,
          modelId: parsed.data.modelId,
        },
      },
    });

    const styleProfile = project.styleProfile as {
      themeConfig?: unknown;
      styleGuide?: string;
      visualStyle?: unknown;
      layoutPatterns?: unknown;
    } | null;

    const pythonAgentData = {
      projectId: id,
      jobId: job.id,
      userId: session.user.id,
      prompt: parsed.data.prompt,
      numSlides: parsed.data.numSlides,
      audienceType: parsed.data.audienceType,
      templateS3Key: project.template?.s3Key || "",
      referenceFileKeys: project.referenceFiles.map((f) => f.s3Key),
      selectedModel: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        baseUrl: llmConfig.baseUrl ?? undefined,
        apiKey: apiKey ?? undefined,
        temperature: llmConfig.temperature ?? 0.7,
        maxTokens: llmConfig.maxTokens ?? 4096,
      },
      langGraphThreadId,
      styleGuide: styleProfile?.styleGuide || "",
      visualStyle: styleProfile?.visualStyle || {},
      layoutPatterns: styleProfile?.layoutPatterns || [],
      profileThemeConfig: styleProfile?.themeConfig || {},
      // Pass theme config for the node worker to use later
      themeConfig: project.template?.themeConfig || styleProfile?.themeConfig || {},
      projectName: project.name,
      engine: parsed.data.engine || "claude-code",
      creativeMode: parsed.data.creativeMode || false,
      useDiagramImages: parsed.data.useDiagramImages || false,
      chatImageKeys: parsed.data.chatImageKeys || [],
    };

    // Enqueue directly to the Python agent queue (dynamic import to avoid bundling ioredis in client)
    const { pptPythonAgentQueue } = await import("@slideforge/queue");
    await pptPythonAgentQueue.add("ai-agent", pythonAgentData, {
      jobId: job.id,
    });

    logger.info(
      { projectId: id, jobId: job.id },
      "Generation job enqueued to Python agent"
    );

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to start generation");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
