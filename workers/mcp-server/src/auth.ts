/**
 * MCP `authenticate` hook for the Preso server.
 *
 * Runs once per MCP session connect. Reads four pieces of context from HTTP
 * headers (the MCP client config supplies them once):
 *
 *   Authorization:        Bearer psf_…       — required, Preso identity
 *   X-Preso-Provider:     openai|anthropic|google|mistral   — required
 *   X-Preso-Provider-Key: <provider api key> — required for non-Google providers
 *   X-Preso-Model:        gemini-2.5-pro     — optional, defaults per-provider
 *
 * On success, returns a `PresoSession` object that's attached to every
 * subsequent tool call's `context.session`. On any failure, throws a
 * `UserError` which FastMCP surfaces as a 401 with a structured message —
 * the user fixes their MCP client config and reconnects.
 *
 * Note: we DON'T validate the bearer against the DB here ourselves. We let
 * the v1 REST API do it on the first real call (it has the audit log,
 * rate-limit, and entitlement checks all wired). Instead, we make ONE cheap
 * "ping" request (GET /v1/llm-configs) to confirm the bearer works before
 * accepting the session — fail fast and give the user a clear error.
 */

import type http from "node:http";
import { UserError } from "fastmcp";
import { PresoClient } from "./client.js";
import {
  DEFAULT_MODELS,
  SUPPORTED_PROVIDERS,
  type PresoSession,
  type SupportedProvider,
} from "./types.js";

const DEFAULT_BASE_URL = process.env.PRESO_API_BASE_URL || "http://localhost:3000";

function header(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" ? v : null;
}

function requireHeader(req: http.IncomingMessage, name: string, hint?: string): string {
  const v = header(req, name);
  if (!v) {
    throw new UserError(
      `Missing ${name} header. ${hint ?? "Add it to your MCP client config."}`,
    );
  }
  return v.trim();
}

export async function authenticatePresoSession(
  req: http.IncomingMessage,
): Promise<PresoSession> {
  // 1. Bearer token.
  const auth = header(req, "authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    throw new UserError(
      "Missing Authorization: Bearer psf_… header. Mint a key in Preso → Settings → Developer.",
    );
  }
  const apiKey = auth.slice(7).trim();
  if (!apiKey.startsWith("psf_") || apiKey.length < 12) {
    throw new UserError(
      "Authorization bearer doesn't look like a Preso API key (psf_…). Re-check your MCP client config.",
    );
  }

  // 2. Provider.
  const providerRaw = requireHeader(
    req,
    "x-preso-provider",
    `Set it to one of: ${SUPPORTED_PROVIDERS.join(", ")}.`,
  ).toLowerCase();
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerRaw)) {
    throw new UserError(
      `X-Preso-Provider must be one of: ${SUPPORTED_PROVIDERS.join(", ")}. Got "${providerRaw}".`,
    );
  }
  const provider = providerRaw as SupportedProvider;

  // 3. Provider key. Optional for Google (server has GOOGLE_API_KEY fallback)
  //    but required for everyone else — we'd rather fail at connect time than
  //    have the agent's first tool call surface a model-not-available error.
  const providerKey = header(req, "x-preso-provider-key")?.trim() || null;
  if (provider !== "google" && !providerKey) {
    throw new UserError(
      `X-Preso-Provider-Key header is required for provider "${provider}". ` +
      `Only "google" can fall back to a server-side key.`,
    );
  }

  // 4. Model id (optional).
  const model = header(req, "x-preso-model")?.trim() || DEFAULT_MODELS[provider];

  // 5. Validate the bearer with a cheap round-trip. If it fails, surface the
  //    REST API's own structured error code in the MCP error message so the
  //    client knows whether to fix the bearer, redeem a coupon, etc.
  const apiBaseUrl = DEFAULT_BASE_URL;
  const client = new PresoClient({ apiBaseUrl, apiKey, provider, providerKey, model });
  try {
    await client.ping();
  } catch (err) {
    const e = err as Error & { code?: string };
    throw new UserError(
      `Preso API rejected the bearer (${e.code ?? "unknown"}): ${e.message}. ` +
      `Re-check your Authorization header and entitlement (provider key or coupon).`,
    );
  }

  return { apiKey, apiBaseUrl, provider, providerKey, model, client };
}
