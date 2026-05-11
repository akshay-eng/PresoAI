import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import type { PresoSession } from "../types.js";

/**
 * `get_deck_status` — non-blocking status check. Useful when an agent
 * already kicked off a generation/edit and wants to peek mid-conversation
 * without waiting (e.g. it has other work to do in parallel).
 */

const inputSchema = z.object({
  jobId: z.string().min(1).describe("Job ID returned by `create_deck` or `edit_deck`."),
});

export const getDeckStatusTool: Tool<PresoSession, typeof inputSchema> = {
  name: "get_deck_status",
  description:
    "Look up the current status of a deck-generation or edit job without " +
    "blocking. Returns phase, progress, and (when complete) the download URL.",
  parameters: inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args, { session }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing");

    const job = await sess.client.getJob(args.jobId);
    return JSON.stringify(
      {
        jobId: job.jobId,
        deckId: job.deckId,
        status: job.status,
        phase: job.phase,
        progress: job.progress,
        message: job.message,
        presentationId: job.presentationId ?? null,
        downloadUrl: job.downloadUrl ?? null,
        slideCount: job.slideCount ?? null,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        error: job.error ?? null,
      },
      null,
      2,
    );
  },
};
