/**
 * Shared types for the Preso MCP server.
 *
 * Every authenticated MCP request carries this `Session` shape, attached by
 * the `authenticate` hook in `src/auth.ts` and surfaced to every tool's
 * `execute` callback as `context.session`. It's the single source of truth
 * for "who is calling, with what provider key, against which Preso instance."
 */

import type { PresoClient } from "./client.js";

export const SUPPORTED_PROVIDERS = ["openai", "anthropic", "google", "mistral"] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * The shape attached to every authenticated MCP session. Index signature is
 * required because FastMCP's `FastMCPSessionAuth` constraint is
 * `Record<string, unknown>` — TypeScript interfaces don't satisfy that
 * unless we declare it explicitly.
 */
export type PresoSession = {
  /** Preso bearer key (psf_…) — same one minted from /settings → Developer. */
  apiKey: string;
  /** Base URL of the Preso REST API. Set by PRESO_API_BASE_URL or defaults to localhost:3000. */
  apiBaseUrl: string;
  /** Which LLM provider deck-generation jobs should use. */
  provider: SupportedProvider;
  /**
   * Provider's own API key. Held in the in-process session for the lifetime
   * of the MCP connection; never logged, never persisted. Optional for Google
   * because the server has a fallback `GOOGLE_API_KEY`.
   */
  providerKey: string | null;
  /** Specific model id (e.g. `gemini-2.5-pro`). Defaults applied per-provider when null. */
  model: string | null;
  /**
   * Pre-built REST client wired with the auth + provider context above.
   * Tools call `session.client.createDeck(...)` instead of building requests.
   */
  client: PresoClient;
  /** Index signature required by FastMCPSessionAuth. */
  [key: string]: unknown;
};

/** Default model per provider when the caller didn't pin one. */
export const DEFAULT_MODELS: Record<SupportedProvider, string> = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.5-pro",
  mistral: "mistral-large-latest",
};
