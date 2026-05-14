import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import { randomUUID } from "node:crypto";
import type { PresoSession } from "../types.js";

/**
 * `create_deck` — the headline tool. Generates a complete presentation deck
 * from a natural-language prompt. Long-running (60-120s for most decks);
 * the tool blocks while emitting MCP progress notifications for each
 * generation phase, then returns the final result with a download URL.
 *
 * The agent uses the URL directly — it's a presigned MinIO/S3 URL valid
 * for 1 hour and points at the actual .pptx bytes.
 */

const inputSchema = z.object({
  prompt: z.string().min(1).max(10000)
    .describe("Plain-English description of the deck. Include topic, audience hint, and key asks."),
  numSlides: z.number().int().min(1).max(15)
    .describe("How many slides to generate (1-15)."),
  audienceType: z.enum(["executive", "technical", "general", "marketing"])
    .optional()
    .describe("Audience type. Tunes density, tone, and visual style. Default: general."),
  engine: z.enum(["preso-pro", "node-worker", "claude-code", "preso-plus"])
    .optional()
    .describe("Generation engine. Default: node-worker (Preso Elite — best mix of quality and speed). `preso-plus` runs Claude Code via an open-source Anthropic→Gemini proxy; no Anthropic key required."),
  creativeMode: z.boolean().optional()
    .describe("When true, pushes the agent toward unconventional layouts (pyramids, hub-and-spoke, comparison diptychs). Default: false."),
  useDiagramImages: z.boolean().optional()
    .describe("Render complex diagrams (sequence flows, architecture) as images via Kroki. Higher fidelity but the slides become non-editable. Default: false."),
  styleProfileId: z.string().optional()
    .describe("ID of a brand style profile (use `list_style_profiles` to enumerate)."),
  referenceFileKeys: z.array(z.string()).max(10).optional()
    .describe("S3 keys for reference decks/PDFs (use `upload_file` to obtain)."),
  chatImageKeys: z.array(z.string()).max(10).optional()
    .describe("S3 keys for vision-input images (e.g. a slide to clone)."),
  name: z.string().max(255).optional()
    .describe("Optional deck name. Auto-derived from the prompt if omitted."),
});

export const createDeckTool: Tool<PresoSession, typeof inputSchema> = {
  name: "create_deck",
  description:
    "Generate a new PowerPoint deck from a natural-language prompt. " +
    "Long-running — emits progress notifications during generation, then " +
    "returns a presigned download URL for the .pptx file. Pair with " +
    "`list_style_profiles` to apply a brand style.",
  parameters: inputSchema,
  annotations: { streamingHint: true, openWorldHint: true, idempotentHint: false },
  timeoutMs: 5 * 60 * 1000, // 5-min ceiling — generation should finish in 60-120s
  execute: async (args, { session, reportProgress, log }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing — auth context not propagated");

    log.info("create_deck dispatching", { prompt: args.prompt.slice(0, 80) });

    // Idempotency key auto-generated per call. Safe to retry on transport
    // hiccups — same key replays the cached job ID for 24 hours.
    const idemKey = randomUUID();
    const created = await sess.client.createDeck(args, idemKey);
    const { jobId, deckId } = created;

    log.info("create_deck job dispatched", { jobId, deckId });

    // Stream progress events into MCP progress notifications. Each `data:`
    // line from /v1/jobs/{id}/stream becomes one MCP `notifications/progress`.
    let lastMessage = "Queued";
    let finalEvent: { phase: string; data?: unknown } | null = null;
    for await (const event of sess.client.streamJob(jobId)) {
      lastMessage = event.message ?? event.phase;
      await reportProgress({
        progress: Math.max(0, Math.min(1, event.progress ?? 0)),
        total: 1,
      });
      // Optional human-readable line for clients that surface log notifications.
      if (event.message) {
        log.info(event.message, { phase: event.phase, progress: event.progress });
      }
      if (event.phase === "complete" || event.phase === "failed") {
        finalEvent = event;
        break;
      }
    }

    if (!finalEvent || finalEvent.phase === "failed") {
      const detail = lastMessage || "generation_failed";
      throw new UserError(`Deck generation failed: ${detail}`);
    }

    // Resolve the download URL. /v1/jobs/{id} usually has it inline once the
    // job completes; if not, /v1/decks/{id}/download will mint a fresh
    // presigned URL.
    const status = await sess.client.getJob(jobId);
    let downloadUrl = status.downloadUrl;
    let presentationId = status.presentationId;
    let slideCount = status.slideCount;
    if (!downloadUrl) {
      const dl = await sess.client.getDownloadUrl(deckId);
      downloadUrl = dl.downloadUrl;
      presentationId = dl.presentationId;
      slideCount = dl.slideCount;
    }

    log.info("create_deck complete", { jobId, deckId, presentationId, slideCount });

    return JSON.stringify(
      {
        deckId,
        jobId,
        presentationId,
        slideCount,
        downloadUrl,
        downloadUrlExpiresInSeconds: 3600,
        message:
          `Deck generated. ${slideCount ?? "?"} slide(s). Download within 1 hour: ${downloadUrl}`,
      },
      null,
      2,
    );
  },
};
