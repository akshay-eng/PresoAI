/**
 * POST /v1/decks/[id]/edit — Surgical edit on an existing deck.
 *
 * Body:
 *   instruction       string  required  — natural-language change description
 *   targetSlides      int[]   optional  — narrow the edit to specific slide numbers
 *   model             object  optional  — same shape as POST /v1/decks (provider override)
 *
 * Same async contract as POST /v1/decks: returns 202 + jobId + status/stream URLs.
 * Uses the slidesData column to patch ONLY the affected slides through the
 * python-agent's edit worker (mode=edit), skipping the langgraph entirely.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { withApiAuth, jsonError, loadIdempotent, storeIdempotent } from "@/lib/v1-auth";

const SUPPORTED_PROVIDERS = ["openai", "anthropic", "google", "mistral"] as const;

const editSchema = z.object({
  instruction: z.string().min(1).max(4000),
  targetSlides: z.array(z.number().int().positive()).optional(),
  model: z.object({
    provider: z.enum(SUPPORTED_PROVIDERS),
    model: z.string().min(1).max(120),
    apiKey: z.string().min(8).max(500),
  }).optional(),
});

interface Ctx { params: Promise<{ id: string }> }

export const POST = (request: NextRequest, ctx: Ctx) =>
  withApiAuth(
    { endpoint: "POST /v1/decks/[id]/edit", expensive: true },
    async (req, auth) => {
      const { id: deckId } = await ctx.params;

      const idemKey = req.headers.get("idempotency-key");
      const cached = await loadIdempotent(auth.apiKey.id, idemKey);
      if (cached) {
        const c = cached as Record<string, unknown> & { jobId?: string };
        if (c.jobId) auth.setJobId(c.jobId);
        return new Response(JSON.stringify(cached), {
          status: 202,
          headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
        });
      }

      let body: unknown;
      try { body = await req.json(); } catch {
        return jsonError(400, "invalid_json", "Request body must be valid JSON");
      }
      const parsed = editSchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(400, "validation_failed", "Invalid request body", parsed.error.flatten());
      }

      // Verify the deck (project) exists and belongs to the bearer's user.
      const project = await prisma.project.findFirst({
        where: { id: deckId, userId: auth.user.id },
        include: { styleProfile: true },
      });
      if (!project) {
        return jsonError(404, "deck_not_found", "Deck not found");
      }

      // Find the latest presentation; we need slidesData for the edit agent.
      const latest = await prisma.presentation.findFirst({
        where: { projectId: deckId },
        orderBy: { version: "desc" },
      });
      if (!latest) {
        return jsonError(
          400,
          "no_deck_to_edit",
          "This deck has not been generated yet. Generate it first via POST /v1/decks before editing.",
        );
      }
      const slidesData = (latest.slidesData as Array<Record<string, unknown>> | null) || null;
      if (!slidesData || slidesData.length === 0) {
        return jsonError(
          422,
          "deck_not_editable",
          "This deck's source code is not available (older deck or non-Preso-Elite engine). " +
          "Regenerate it once via POST /v1/decks and edits will work from then on.",
        );
      }

      // Resolve LLM. Same precedence as POST /v1/decks.
      let modelDispatch: { provider: string; model: string; apiKey: string | null } | null = null;
      if (parsed.data.model) {
        modelDispatch = {
          provider: parsed.data.model.provider,
          model: parsed.data.model.model,
          apiKey: parsed.data.model.apiKey,
        };
      } else {
        // Priority: user's isDefault first, then google → anthropic → openai → mistral.
        // Google is preferred because it has a server-side fallback (GOOGLE_API_KEY env),
        // so the dispatch never fails just because a user's other key is exhausted.
        const PROVIDER_RANK: Record<string, number> = {
          google: 0, anthropic: 1, openai: 2, mistral: 3,
        };
        const rawConfigs = await prisma.lLMConfig.findMany({
          where: {
            OR: [{ userId: auth.user.id }, { userId: null }],
            provider: { in: SUPPORTED_PROVIDERS as unknown as string[] },
          },
        });
        const llmConfigs = [...rawConfigs].sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
          const ra = PROVIDER_RANK[a.provider] ?? 99;
          const rb = PROVIDER_RANK[b.provider] ?? 99;
          return ra - rb;
        });
        for (const cfg of llmConfigs) {
          let apiKey: string | null = null;
          const userKey = await prisma.providerApiKey.findUnique({
            where: { userId_provider: { userId: auth.user.id, provider: cfg.provider } },
          });
          if (userKey?.apiKeyEnc) {
            try { apiKey = decrypt(userKey.apiKeyEnc); } catch { /* try next */ }
          }
          if (!apiKey && cfg.apiKeyEnc) {
            try { apiKey = decrypt(cfg.apiKeyEnc); } catch { /* try next */ }
          }
          if (apiKey || cfg.provider === "google") {
            modelDispatch = { provider: cfg.provider, model: cfg.model, apiKey };
            break;
          }
        }
        if (!modelDispatch) {
          return jsonError(400, "no_model_available", "No usable LLM is configured for this account.");
        }
      }

      const themeSnap = (latest.themeSnapshot as { themeConfig?: unknown } | null) || null;
      const themeConfig = (themeSnap?.themeConfig as object | undefined)
        || (project.styleProfile?.themeConfig as object | null) || {};

      const job = await prisma.job.create({
        data: {
          type: "PPT_GENERATION",
          status: "PROCESSING",
          projectId: deckId,
          userId: auth.user.id,
          startedAt: new Date(),
          input: {
            source: "v1_api",
            mode: "edit",
            apiKeyId: auth.apiKey.id,
            instruction: parsed.data.instruction,
            targetSlides: parsed.data.targetSlides ?? [],
            basePresentationId: latest.id,
          },
        },
      });
      auth.setJobId(job.id);

      const editJobData = {
        mode: "edit" as const,
        projectId: deckId,
        jobId: job.id,
        userId: auth.user.id,
        basePresentationId: latest.id,
        instruction: parsed.data.instruction,
        targetSlides: parsed.data.targetSlides ?? null,
        existingSlides: slidesData,
        themeConfig,
        styleGuide: project.styleProfile?.styleGuide || "",
        visualStyle: (project.styleProfile?.visualStyle as object | null) || {},
        projectName: project.name,
        selectedModel: {
          provider: modelDispatch.provider,
          model: modelDispatch.model,
          apiKey: modelDispatch.apiKey ?? undefined,
          temperature: 0.4,
          maxTokens: 16000,
        },
      };

      try {
        const { pptPythonAgentQueue } = await import("@slideforge/queue");
        await pptPythonAgentQueue.add("edit-deck", editJobData, { jobId: job.id });
      } catch (err) {
        logger.error(
          { jobId: job.id, err: (err as Error).message },
          "v1 edit: dispatch failed"
        );
        await prisma.job.update({
          where: { id: job.id },
          data: { status: "FAILED", error: "Dispatch failed", completedAt: new Date() },
        }).catch(() => undefined);
        return jsonError(503, "dispatch_failed", "Could not enqueue edit job. Try again shortly.");
      }

      const baseUrl = new URL(req.url).origin;
      const responseBody = {
        jobId: job.id,
        deckId,
        status: "queued",
        statusUrl: `${baseUrl}/api/v1/jobs/${job.id}`,
        streamUrl: `${baseUrl}/api/v1/jobs/${job.id}/stream`,
      };
      void storeIdempotent(auth.apiKey.id, idemKey, responseBody);

      logger.info(
        { jobId: job.id, deckId, apiKeyId: auth.apiKey.id, slideCount: slidesData.length },
        "v1 edit dispatched"
      );

      return new Response(JSON.stringify(responseBody), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    },
  )(request);
