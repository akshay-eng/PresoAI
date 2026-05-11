import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import type { PresoSession } from "../types.js";

const inputSchema = z.object({
  deckId: z.string().min(1).describe("Deck ID."),
  version: z.number().int().positive().optional()
    .describe("Specific presentation version. Defaults to the latest."),
});

export const downloadDeckTool: Tool<PresoSession, typeof inputSchema> = {
  name: "download_deck",
  description:
    "Get a presigned download URL for a deck's rendered .pptx. URL is valid " +
    "for 1 hour. Pass to the user or fetch directly.",
  parameters: inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args, { session }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing");
    const result = await sess.client.getDownloadUrl(args.deckId, args.version);
    return JSON.stringify(result, null, 2);
  },
};
