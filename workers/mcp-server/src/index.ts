/**
 * Preso MCP server — entry point.
 *
 * Exposes the v1 REST API as MCP tools on a remote (HTTP+Streamable)
 * endpoint at POST /mcp on port 8200. Auth + per-request context come in
 * via HTTP headers; see src/auth.ts.
 *
 * Boot:   pnpm --filter @slideforge/mcp-server dev
 * Probe:  curl http://localhost:8200/health
 *
 * Environment:
 *   PRESO_API_BASE_URL   — REST API base. Default: http://localhost:3000
 *   MCP_PORT             — listen port. Default: 8200
 *   MCP_HOST             — bind host. Default: 0.0.0.0
 *   MCP_ENDPOINT         — MCP path. Default: /mcp
 */

import "dotenv/config";
import pino from "pino";
import { FastMCP } from "fastmcp";

import { authenticatePresoSession } from "./auth.js";
import type { PresoSession } from "./types.js";

import { createDeckTool } from "./tools/create-deck.js";
import { editDeckTool } from "./tools/edit-deck.js";
import { getDeckStatusTool } from "./tools/get-deck-status.js";
import { listDecksTool } from "./tools/list-decks.js";
import { listStyleProfilesTool } from "./tools/list-style-profiles.js";
import { downloadDeckTool } from "./tools/download-deck.js";
import { uploadFileTool } from "./tools/upload-file.js";

const logger = pino({ name: "preso-mcp" });

const PORT = parseInt(process.env.MCP_PORT || "8200", 10);
const HOST = process.env.MCP_HOST || "0.0.0.0";
const ENDPOINT = (process.env.MCP_ENDPOINT || "/mcp") as `/${string}`;

async function main() {
  const server = new FastMCP<PresoSession>({
    name: "preso",
    version: "1.0.0",
    instructions:
      "Preso generates and edits enterprise-quality PowerPoint decks. The " +
      "headline tool is `create_deck` — given a prompt and slide count, it " +
      "returns a presigned download URL for a finished .pptx. Use " +
      "`list_style_profiles` to brand the deck (IBM/ICICI/Wipro globals or " +
      "the user's own profiles), `upload_file` to add reference material, " +
      "and `edit_deck` to surgically tweak slides afterward — the agent " +
      "patches only what the instruction names and leaves the rest alone.",
    authenticate: authenticatePresoSession,
    health: { enabled: true, path: "/health" },
  });

  // Tools — order doesn't matter; FastMCP advertises them via tools/list.
  server.addTool(createDeckTool);
  server.addTool(editDeckTool);
  server.addTool(getDeckStatusTool);
  server.addTool(listDecksTool);
  server.addTool(listStyleProfilesTool);
  server.addTool(downloadDeckTool);
  server.addTool(uploadFileTool);

  server.on("connect", (e) => {
    const sess = (e.session as unknown as { auth?: PresoSession }).auth;
    logger.info(
      { provider: sess?.provider, model: sess?.model, prefix: sess?.apiKey?.slice(0, 12) },
      "MCP client connected"
    );
  });
  server.on("disconnect", () => logger.info("MCP client disconnected"));

  await server.start({
    transportType: "httpStream",
    httpStream: { port: PORT, host: HOST, endpoint: ENDPOINT },
  });

  logger.info(
    { url: `http://${HOST}:${PORT}${ENDPOINT}`, healthUrl: `http://${HOST}:${PORT}/health` },
    "Preso MCP server listening"
  );
}

main().catch((err) => {
  logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "MCP server crashed");
  process.exit(1);
});
