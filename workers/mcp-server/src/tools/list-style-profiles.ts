import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import type { PresoSession } from "../types.js";

const inputSchema = z.object({});

export const listStyleProfilesTool: Tool<PresoSession, typeof inputSchema> = {
  name: "list_style_profiles",
  description:
    "List the brand style profiles available to this account (the user's own " +
    "+ the platform globals: IBM Enterprise, ICICI Bank Corporate, Wipro " +
    "Consulting). Pass an `id` from this list as `styleProfileId` in `create_deck` " +
    "to lock the deck to that brand identity.",
  parameters: inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true },
  execute: async (_args, { session }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing");
    const result = await sess.client.listStyleProfiles();
    return JSON.stringify(result, null, 2);
  },
};
