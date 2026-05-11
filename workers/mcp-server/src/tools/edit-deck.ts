import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import { randomUUID } from "node:crypto";
import type { PresoSession } from "../types.js";

/**
 * `edit_deck` — surgically patch an existing deck. Same long-running
 * progress-notifications pattern as `create_deck`. Affects only the slides
 * the instruction touches; the rest pass through unchanged.
 */

const inputSchema = z.object({
  deckId: z.string().min(1)
    .describe("ID of the deck to edit. Get it from `list_decks` or the result of a previous `create_deck`."),
  instruction: z.string().min(1).max(4000)
    .describe(
      "What to change. Be specific — name the slide(s) when you can " +
      "(e.g. 'change slide 3 to a bar chart', 'tighten the cover subtitle')."
    ),
  targetSlides: z.array(z.number().int().positive()).optional()
    .describe("Optional hint about which 1-based slide numbers to focus on."),
});

export const editDeckTool: Tool<PresoSession, typeof inputSchema> = {
  name: "edit_deck",
  description:
    "Surgically edit an existing deck. Patches only the slides affected by " +
    "your instruction; everything else passes through unchanged. Returns the " +
    "new presentation version's download URL when done.",
  parameters: inputSchema,
  annotations: { streamingHint: true, openWorldHint: true, idempotentHint: false },
  timeoutMs: 5 * 60 * 1000,
  execute: async (args, { session, reportProgress, log }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing — auth context not propagated");

    log.info("edit_deck dispatching", { deckId: args.deckId, instruction: args.instruction.slice(0, 80) });

    const idemKey = randomUUID();
    const dispatched = await sess.client.editDeck(
      args.deckId,
      { instruction: args.instruction, targetSlides: args.targetSlides },
      idemKey,
    );
    const { jobId, deckId } = dispatched;

    log.info("edit_deck job dispatched", { jobId, deckId });

    let lastMessage = "Queued";
    let finalEvent: { phase: string } | null = null;
    for await (const event of sess.client.streamJob(jobId)) {
      lastMessage = event.message ?? event.phase;
      await reportProgress({
        progress: Math.max(0, Math.min(1, event.progress ?? 0)),
        total: 1,
      });
      if (event.message) log.info(event.message, { phase: event.phase });
      if (event.phase === "complete" || event.phase === "failed") {
        finalEvent = event;
        break;
      }
    }

    if (!finalEvent || finalEvent.phase === "failed") {
      throw new UserError(`Deck edit failed: ${lastMessage || "generation_failed"}`);
    }

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

    return JSON.stringify(
      {
        deckId,
        jobId,
        presentationId,
        slideCount,
        downloadUrl,
        downloadUrlExpiresInSeconds: 3600,
        message: `Deck edited. New version available — download within 1 hour: ${downloadUrl}`,
      },
      null,
      2,
    );
  },
};
