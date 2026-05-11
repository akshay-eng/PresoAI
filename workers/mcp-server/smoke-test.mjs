// Minimal MCP smoke client. Lists tools then invokes list_style_profiles
// (cheapest read-only call) to confirm the server is healthy end-to-end.
//
// Usage:
//   PRESO_API_KEY=psf_… X_PRESO_PROVIDER_KEY=AIza… node smoke-test.mjs
//
// Env vars (all optional except PRESO_API_KEY):
//   MCP_URL                 default: http://localhost:8200/mcp
//   PRESO_API_KEY           required: your psf_… bearer (mint at /settings → Developer)
//   X_PRESO_PROVIDER        default: google
//   X_PRESO_MODEL           default: gemini-2.5-pro
//   X_PRESO_PROVIDER_KEY    required for non-Google providers

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = new URL(process.env.MCP_URL || "http://localhost:8200/mcp");
const PRESO_API_KEY = process.env.PRESO_API_KEY;
if (!PRESO_API_KEY) {
  console.error("Set PRESO_API_KEY to your psf_… bearer (mint one in Settings → Developer).");
  process.exit(2);
}
const HEADERS = {
  Authorization: `Bearer ${PRESO_API_KEY}`,
  "X-Preso-Provider": process.env.X_PRESO_PROVIDER || "google",
  "X-Preso-Model": process.env.X_PRESO_MODEL || "gemini-2.5-pro",
  ...(process.env.X_PRESO_PROVIDER_KEY
    ? { "X-Preso-Provider-Key": process.env.X_PRESO_PROVIDER_KEY }
    : {}),
};

const transport = new StreamableHTTPClientTransport(URL_, {
  requestInit: { headers: HEADERS },
});
const client = new Client({ name: "smoke-test", version: "1.0" }, { capabilities: {} });

await client.connect(transport);
console.log("connected");

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name));

const result = await client.callTool({
  name: "list_style_profiles",
  arguments: {},
});
console.log("list_style_profiles result:");
for (const part of result.content || []) {
  if (part.type === "text") console.log(part.text.slice(0, 400));
}

await client.close();
console.log("done");
