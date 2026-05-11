// End-to-end smoke test of the headline tool: create_deck.
// Generates a 1-slide deck via MCP, prints progress notifications as they
// arrive, and prints the final result (presigned downloadUrl + metadata).
//
// Usage:
//   PRESO_API_KEY=psf_… X_PRESO_PROVIDER_KEY=AIza… node smoke-create-deck.mjs
//
// See smoke-test.mjs for the full env-var list.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = new URL(process.env.MCP_URL || "http://localhost:8200/mcp");
const PRESO_API_KEY = process.env.PRESO_API_KEY;
if (!PRESO_API_KEY) {
  console.error("Set PRESO_API_KEY to your psf_… bearer.");
  process.exit(2);
}

const transport = new StreamableHTTPClientTransport(URL_, {
  requestInit: {
    headers: {
      Authorization: `Bearer ${PRESO_API_KEY}`,
      "X-Preso-Provider": process.env.X_PRESO_PROVIDER || "google",
      "X-Preso-Model": process.env.X_PRESO_MODEL || "gemini-2.5-pro",
      ...(process.env.X_PRESO_PROVIDER_KEY
        ? { "X-Preso-Provider-Key": process.env.X_PRESO_PROVIDER_KEY }
        : {}),
    },
  },
});
const client = new Client(
  { name: "smoke-create-deck", version: "1.0" },
  { capabilities: {} },
);

await client.connect(transport);
console.log("connected");

// Subscribe to all unhandled notifications via the fallback hook so we
// can see progress events without importing the SDK's Zod schemas.
client.fallbackNotificationHandler = async (n) => {
  const params = (n.params || {});
  if (n.method === "notifications/progress") {
    const pct = Math.round((Number(params.progress) / Number(params.total ?? 1)) * 100);
    console.log(`[progress] ${pct}%`);
  } else if (n.method === "notifications/message") {
    console.log(`[log] ${params.data ?? params.level}`);
  }
};

const t0 = Date.now();
const result = await client.callTool({
  name: "create_deck",
  arguments: {
    prompt: process.env.PROMPT
      || "1-slide cover for an agentic ITOps platform aimed at Fortune 500 banks. Confident, executive tone.",
    numSlides: parseInt(process.env.NUM_SLIDES || "1", 10),
    audienceType: process.env.AUDIENCE || "executive",
    creativeMode: process.env.CREATIVE === "true",
  },
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\ncreate_deck completed in ${elapsed}s`);
for (const part of result.content || []) {
  if (part.type === "text") console.log(part.text);
}

await client.close();
console.log("done");
