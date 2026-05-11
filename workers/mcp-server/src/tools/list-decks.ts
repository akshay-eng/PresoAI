import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import type { PresoSession } from "../types.js";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
    .describe("Maximum results to return (1-100). Default: 20."),
  cursor: z.string().optional()
    .describe("Pagination cursor returned by a previous call's `nextCursor`."),
  search: z.string().max(200).optional()
    .describe("Case-insensitive substring filter on deck name."),
});

export const listDecksTool: Tool<PresoSession, typeof inputSchema> = {
  name: "list_decks",
  description:
    "List the user's recent decks (newest first). Cursor-paginated. Each item " +
    "has a `deckId` you can pass to `edit_deck`, `download_deck`, or `get_deck_status`.",
  parameters: inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (args, { session }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing");
    const result = await sess.client.listDecks(args);
    return JSON.stringify(result, null, 2);
  },
};
