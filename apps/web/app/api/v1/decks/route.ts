/**
 * POST /v1/decks — Create a deck.
 *
 * Auth:    Authorization: Bearer psf_…
 * Idem:    Idempotency-Key: <client-supplied uuid>   (optional, retry-safe)
 *
 * Body (JSON):
 *   prompt              string  required  — what the deck is about
 *   numSlides           int     required  — 1-15
 *   audienceType        enum    optional  — executive | technical | general | marketing  (default: general)
 *   engine              enum    optional  — preso-pro | node-worker | preso-plus  (default: node-worker)
 *   creativeMode        bool    optional
 *   useDiagramImages    bool    optional
 *   useImageGen         bool    optional  — enable AI photo backgrounds
 *   styleProfileId      string  optional
 *   referenceFileKeys   string[] optional — s3 keys from POST /v1/files
 *   chatImageKeys       string[] optional — s3 keys for vision input
 *   model               object  optional  — { provider, model, apiKey } body-passed override
 *                                            for the LLM call. provider must be one of the
 *                                            four supported (openai/anthropic/google/mistral).
 *                                            If omitted, falls back to user's stored provider key.
 *
 * Response: 202 Accepted
 *   { jobId, deckId (projectId), status: "queued",
 *     statusUrl, streamUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { withApiAuth, jsonError, loadIdempotent, storeIdempotent } from "@/lib/v1-auth";

/**
 * GET /v1/decks
 *
 * List the user's recent decks. Cursor-paginated by createdAt DESC.
 *
 * Query: ?limit=20 (1-100, default 20), ?cursor=<deckId>, ?search=<text>
 * Response: { items: [{ deckId, name, slideCount, createdAt, latestPresentationId }], nextCursor }
 */
export const GET = withApiAuth(
  { endpoint: "GET /v1/decks" },
  async (request, ctx) => {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const cursor = url.searchParams.get("cursor") || undefined;
    const search = (url.searchParams.get("search") || "").trim();

    const projects = await prisma.project.findMany({
      where: {
        userId: ctx.user.id,
        // Only surface decks that originated from the API/MCP — keeps this
        // endpoint scoped to "things this caller can plausibly own/track".
        source: { in: ["api", "mcp"] },
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        presentations: { orderBy: { version: "desc" }, take: 1, select: { id: true, slideCount: true } },
      },
    });

    const hasMore = projects.length > limit;
    const sliced = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : null;

    return NextResponse.json({
      items: sliced.map((p) => ({
        deckId: p.id,
        name: p.name,
        prompt: p.prompt.slice(0, 240),
        audienceType: p.audienceType,
        numSlides: p.numSlides,
        latestPresentationId: p.presentations[0]?.id ?? null,
        slideCount: p.presentations[0]?.slideCount ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      nextCursor,
    });
  },
);

const SUPPORTED_PROVIDERS = ["openai", "anthropic", "google", "mistral"] as const;

const modelOverrideSchema = z.object({
  provider: z.enum(SUPPORTED_PROVIDERS),
  model: z.string().min(1).max(120),
  apiKey: z.string().min(8).max(500),
});

const createDeckSchema = z.object({
  prompt: z.string().min(1).max(10000),
  numSlides: z.number().int().min(1).max(15),
  audienceType: z.enum(["executive", "technical", "general", "marketing"]).default("general"),
  engine: z.enum(["claude-code", "preso-plus", "node-worker", "preso-pro"]).default("node-worker"),
  creativeMode: z.boolean().default(false),
  useDiagramImages: z.boolean().default(false),
  useImageGen: z.boolean().default(false),
  styleProfileId: z.string().optional(),
  referenceFileKeys: z.array(z.string().min(1).max(500)).max(10).optional(),
  chatImageKeys: z.array(z.string().min(1).max(500)).max(10).optional(),
  model: modelOverrideSchema.optional(),
  // Optional human-readable name for the project. If omitted we'll auto-name
  // from the prompt via the existing summarizer, same as the dashboard.
  name: z.string().min(1).max(255).optional(),
});

export const POST = withApiAuth(
  { endpoint: "POST /v1/decks", expensive: true },
  async (request, ctx) => {
    const idemKey = request.headers.get("idempotency-key");
    if (idemKey && idemKey.length > 200) {
      return jsonError(400, "validation_failed", "Idempotency-Key is too long (max 200)");
    }

    // Idempotent replay: if we've seen this (apiKey, idem) combo, replay the
    // same response so retries are safe.
    const cached = await loadIdempotent(ctx.apiKey.id, idemKey);
    if (cached) {
      const c = cached as Record<string, unknown> & { jobId?: string };
      if (c.jobId) ctx.setJobId(c.jobId);
      return new Response(JSON.stringify(cached), {
        status: 202,
        headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_json", "Request body must be valid JSON");
    }
    const parsed = createDeckSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "validation_failed", "Invalid request body", parsed.error.flatten());
    }

    // Resolve the LLM the job will use. Two paths:
    //   (a) Caller passed `model: { provider, model, apiKey }` — use it directly,
    //       no DB lookup (the override is per-request, not stored).
    //   (b) Otherwise, find the user's stored provider key for ANY supported
    //       provider; pick a reasonable default (gemini > anthropic > openai > mistral).
    let modelDispatch: {
      provider: string;
      model: string;
      apiKey: string | null;
      llmConfigId: string | null;
    } | null = null;

    if (parsed.data.model) {
      modelDispatch = {
        provider: parsed.data.model.provider,
        model: parsed.data.model.model,
        apiKey: parsed.data.model.apiKey,
        llmConfigId: null,
      };
    } else {
      // Walk the user's available LLMConfigs in order of preference.
      //
      // Priority:
      //   1. User's `isDefault` config — explicit user choice always wins.
      //   2. Provider preference: google → anthropic → openai → mistral.
      //      Google is first because it has a server-side fallback key
      //      (GOOGLE_API_KEY env), so we know it'll work even if the user's
      //      own key has issues. Without this bias, alphabetical order
      //      picks Anthropic first — and an exhausted Anthropic key
      //      surprises the caller mid-flight.
      const PROVIDER_RANK: Record<string, number> = {
        google: 0, anthropic: 1, openai: 2, mistral: 3,
      };
      const rawConfigs = await prisma.lLMConfig.findMany({
        where: {
          OR: [{ userId: ctx.user.id }, { userId: null }],
          provider: { in: SUPPORTED_PROVIDERS as unknown as string[] },
        },
      });
      const llmConfigs = [...rawConfigs].sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        const ra = PROVIDER_RANK[a.provider] ?? 99;
        const rb = PROVIDER_RANK[b.provider] ?? 99;
        return ra - rb;
      });

      // Try each config until we find one where we can resolve a usable api key.
      for (const cfg of llmConfigs) {
        let apiKey: string | null = null;

        const userKey = await prisma.providerApiKey.findUnique({
          where: { userId_provider: { userId: ctx.user.id, provider: cfg.provider } },
        });
        if (userKey?.apiKeyEnc) {
          try { apiKey = decrypt(userKey.apiKeyEnc); } catch { /* try next */ }
        }
        if (!apiKey && cfg.apiKeyEnc) {
          try { apiKey = decrypt(cfg.apiKeyEnc); } catch { /* try next */ }
        }
        // For Google specifically, the python-agent has a server fallback
        // (GOOGLE_API_KEY env). For other providers the request needs a key.
        if (apiKey || cfg.provider === "google") {
          modelDispatch = {
            provider: cfg.provider,
            model: cfg.model,
            apiKey,
            llmConfigId: cfg.id,
          };
          break;
        }
      }

      if (!modelDispatch) {
        return jsonError(
          400,
          "no_model_available",
          "No usable LLM is configured for this account. Add a provider API key in Settings → API Keys, " +
          "or pass `model` in the request body.",
        );
      }
    }

    // If a styleProfileId was passed, verify it belongs to the user OR is global.
    if (parsed.data.styleProfileId) {
      const sp = await prisma.styleProfile.findFirst({
        where: {
          id: parsed.data.styleProfileId,
          OR: [{ userId: ctx.user.id }, { isGlobal: true }],
        },
        select: { id: true },
      });
      if (!sp) {
        return jsonError(404, "style_profile_not_found", "styleProfileId is not visible to this account");
      }
    }

    // Derive a project name. We try the LLM summarizer (3-7 word phrase) but
    // tolerate failure — falls back to the truncated prompt.
    let projectName = parsed.data.name?.trim() || parsed.data.prompt.slice(0, 60);
    if (!parsed.data.name) {
      try {
        const { summarizeForName } = await import("@/lib/llm-naming");
        const nice = await summarizeForName(parsed.data.prompt, "project");
        if (nice && nice.length >= 2) projectName = nice;
      } catch { /* keep fallback */ }
    }

    // Create project + job in a single transaction so partial failures don't
    // leave orphan rows.
    const styleProfile = parsed.data.styleProfileId
      ? await prisma.styleProfile.findUnique({
          where: { id: parsed.data.styleProfileId },
        })
      : null;

    const langGraphThreadId = `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Detect MCP-routed calls so the API-usage page can split them out from
    // direct REST traffic. The MCP server sets a recognizable User-Agent.
    const ua = request.headers.get("user-agent") || "";
    const isMcp = /preso-mcp|@modelcontextprotocol|fastmcp/i.test(ua);
    const projectSource = isMcp ? "mcp" : "api";

    const { project, job } = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: projectName,
          prompt: parsed.data.prompt,
          numSlides: parsed.data.numSlides,
          audienceType: parsed.data.audienceType,
          userId: ctx.user.id,
          source: projectSource,
          apiKeyId: ctx.apiKey.id,
          ...(modelDispatch!.llmConfigId ? { llmConfigId: modelDispatch!.llmConfigId } : {}),
          ...(parsed.data.styleProfileId ? { styleProfileId: parsed.data.styleProfileId } : {}),
        },
      });
      const job = await tx.job.create({
        data: {
          type: "PPT_GENERATION",
          status: "PROCESSING",
          projectId: project.id,
          userId: ctx.user.id,
          langGraphThreadId,
          startedAt: new Date(),
          input: {
            source: "v1_api",
            apiKeyId: ctx.apiKey.id,
            prompt: parsed.data.prompt,
            numSlides: parsed.data.numSlides,
            audienceType: parsed.data.audienceType,
            engine: parsed.data.engine,
            creativeMode: parsed.data.creativeMode,
            useDiagramImages: parsed.data.useDiagramImages,
          },
        },
      });
      return { project, job };
    });

    ctx.setJobId(job.id);

    // Dispatch to the python-agent BullMQ queue using the same payload shape
    // the existing /api/projects/[id]/generate endpoint uses.
    const pythonAgentData = {
      projectId: project.id,
      jobId: job.id,
      userId: ctx.user.id,
      prompt: parsed.data.prompt,
      numSlides: parsed.data.numSlides,
      audienceType: parsed.data.audienceType,
      templateS3Key: "",
      referenceFileKeys: parsed.data.referenceFileKeys || [],
      selectedModel: {
        provider: modelDispatch.provider,
        model: modelDispatch.model,
        baseUrl: undefined,
        apiKey: modelDispatch.apiKey ?? undefined,
        temperature: 0.7,
        maxTokens: 4096,
      },
      langGraphThreadId,
      styleGuide: styleProfile?.styleGuide || "",
      visualStyle: (styleProfile?.visualStyle as object | null) || {},
      layoutPatterns: (styleProfile?.layoutPatterns as unknown[] | null) || [],
      profileThemeConfig: (styleProfile?.themeConfig as object | null) || {},
      themeConfig: (styleProfile?.themeConfig as object | null) || {},
      projectName,
      engine: parsed.data.engine,
      creativeMode: parsed.data.creativeMode,
      useDiagramImages: parsed.data.useDiagramImages,
      useImageGen: parsed.data.useImageGen,
      chatImageKeys: parsed.data.chatImageKeys || [],
    };

    try {
      const { pptPythonAgentQueue } = await import("@slideforge/queue");
      await pptPythonAgentQueue.add("ai-agent", pythonAgentData, { jobId: job.id });
    } catch (err) {
      logger.error(
        { jobId: job.id, err: (err as Error).message },
        "v1 deck-create: dispatch to python-agent failed"
      );
      // Mark the job failed so polling clients see the failure rather than hanging.
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "FAILED", error: "Dispatch failed", completedAt: new Date() },
      }).catch(() => undefined);
      return jsonError(503, "dispatch_failed", "Could not enqueue generation job. Try again shortly.");
    }

    const baseUrl = new URL(request.url).origin;
    const responseBody = {
      jobId: job.id,
      deckId: project.id,
      status: "queued",
      statusUrl: `${baseUrl}/api/v1/jobs/${job.id}`,
      streamUrl: `${baseUrl}/api/v1/jobs/${job.id}/stream`,
    };

    // Cache for idempotent replay (24h).
    void storeIdempotent(ctx.apiKey.id, idemKey, responseBody);

    logger.info(
      { jobId: job.id, projectId: project.id, apiKeyId: ctx.apiKey.id, engine: parsed.data.engine },
      "v1 deck-create dispatched"
    );

    return new Response(JSON.stringify(responseBody), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  },
);
