/**
 * Thin client over the Preso v1 REST API. Each MCP session gets one of these
 * configured with the user's bearer token + provider context. Tools call
 * methods on it (e.g. `client.createDeck(args)`) instead of building HTTP
 * requests inline.
 *
 * Two design choices worth noting:
 *
 *   1. Provider-key injection. POST endpoints that dispatch generation jobs
 *      (createDeck, editDeck) automatically get a `model: { provider, model,
 *      apiKey: providerKey }` body field added — so the agent doesn't have
 *      to thread the provider key through every tool call. The headers the
 *      MCP client passed in are the source of truth.
 *
 *   2. SSE streaming. `streamJob` is an async iterator that yields each
 *      progress event as it arrives from the v1 stream endpoint. The
 *      `create_deck` and `edit_deck` tools consume it to drive MCP progress
 *      notifications.
 */

import type { SupportedProvider } from "./types.js";

interface ClientConfig {
  apiBaseUrl: string;
  apiKey: string;
  provider: SupportedProvider;
  providerKey: string | null;
  model: string | null;
}

interface ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

function buildApiError(status: number, body: unknown): ApiError {
  const b = (body as { error?: { code?: string; message?: string; details?: unknown } } | null) ?? null;
  const code = b?.error?.code ?? `http_${status}`;
  const message = b?.error?.message ?? `Preso API responded with ${status}`;
  const e = new Error(message) as ApiError;
  e.status = status;
  e.code = code;
  e.details = b?.error?.details;
  return e;
}

export interface CreateDeckArgs {
  prompt: string;
  numSlides: number;
  audienceType?: "executive" | "technical" | "general" | "marketing";
  engine?: "preso-pro" | "node-worker" | "preso-plus";
  creativeMode?: boolean;
  useDiagramImages?: boolean;
  useImageGen?: boolean;
  styleProfileId?: string;
  referenceFileKeys?: string[];
  chatImageKeys?: string[];
  name?: string;
}

export interface CreateDeckResponse {
  jobId: string;
  deckId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  statusUrl: string;
  streamUrl: string;
}

export interface EditDeckArgs {
  instruction: string;
  targetSlides?: number[];
}

export interface JobStatus {
  jobId: string;
  deckId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  phase: string | null;
  progress: number;
  message: string | null;
  presentationId?: string;
  downloadUrl?: string;
  slideCount?: number;
  createdAt: string;
  completedAt: string | null;
  error?: { code: string; message: string };
}

export interface DeckMetadata {
  deckId: string;
  name: string;
  prompt: string;
  audienceType: string;
  numSlides: number;
  styleProfileId: string | null;
  createdAt: string;
  presentations: Array<{
    id: string;
    version: number;
    slideCount: number;
    title: string;
    createdAt: string;
  }>;
}

export interface DownloadResponse {
  presentationId: string;
  version: number;
  slideCount: number;
  downloadUrl: string;
  expiresIn: number;
}

export interface StyleProfile {
  id: string;
  name: string;
  description: string | null;
  isGlobal: boolean;
  createdAt: string;
}

export interface JobStreamEvent {
  phase: string;
  progress: number;
  message?: string;
  data?: unknown;
}

export class PresoClient {
  private readonly cfg: ClientConfig;

  constructor(cfg: ClientConfig) {
    this.cfg = cfg;
  }

  /** Cheapest authenticated endpoint — used at connect time to fail fast. */
  async ping(): Promise<void> {
    await this.request<unknown>("GET", "/api/v1/llm-configs");
  }

  // ─── Decks ───────────────────────────────────────────────────────────────

  async createDeck(args: CreateDeckArgs, idempotencyKey?: string): Promise<CreateDeckResponse> {
    return this.request<CreateDeckResponse>(
      "POST",
      "/api/v1/decks",
      this.injectModel(args),
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    );
  }

  async editDeck(
    deckId: string,
    args: EditDeckArgs,
    idempotencyKey?: string,
  ): Promise<CreateDeckResponse> {
    return this.request<CreateDeckResponse>(
      "POST",
      `/api/v1/decks/${encodeURIComponent(deckId)}/edit`,
      this.injectModel(args),
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    );
  }

  async getDeck(deckId: string): Promise<DeckMetadata> {
    return this.request<DeckMetadata>("GET", `/api/v1/decks/${encodeURIComponent(deckId)}`);
  }

  async getDownloadUrl(deckId: string, version?: number): Promise<DownloadResponse> {
    const qs = version ? `?version=${version}` : "";
    return this.request<DownloadResponse>(
      "GET",
      `/api/v1/decks/${encodeURIComponent(deckId)}/download${qs}`,
    );
  }

  // ─── Jobs ────────────────────────────────────────────────────────────────

  async getJob(jobId: string): Promise<JobStatus> {
    return this.request<JobStatus>("GET", `/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  /** Async-iterator over the SSE stream for a job. Yields each parsed event. */
  async *streamJob(jobId: string, opts: { signal?: AbortSignal } = {}): AsyncIterable<JobStreamEvent> {
    const url = `${this.cfg.apiBaseUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/stream`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, Accept: "text/event-stream" },
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* ignore */ }
      throw buildApiError(res.status, body);
    }

    // Manual SSE parsing — simpler than pulling in eventsource-parser. Each
    // event in the stream is delimited by a blank line; lines starting with
    // "data:" carry the JSON payload. Comment lines (starting with ":") are
    // heartbeats we ignore.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (!data) continue;
              try {
                const event = JSON.parse(data) as JobStreamEvent;
                yield event;
                if (event.phase === "complete" || event.phase === "failed") return;
              } catch {
                // not JSON; ignore
              }
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }

  async listDecks(opts: { limit?: number; cursor?: string; search?: string } = {}): Promise<{
    items: Array<{
      deckId: string;
      name: string;
      prompt: string;
      audienceType: string;
      numSlides: number;
      latestPresentationId: string | null;
      slideCount: number | null;
      createdAt: string;
    }>;
    nextCursor: string | null;
  }> {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.search) qs.set("search", opts.search);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return this.request("GET", `/api/v1/decks${tail}`);
  }

  // ─── Catalog ─────────────────────────────────────────────────────────────

  async listStyleProfiles(): Promise<{ items: StyleProfile[] }> {
    return this.request<{ items: StyleProfile[] }>("GET", "/api/v1/style-profiles");
  }

  // ─── Files ───────────────────────────────────────────────────────────────

  async presignFileUpload(args: {
    fileName: string;
    contentType: string;
    purpose?: "reference" | "chat-image" | "template";
  }): Promise<{ uploadUrl: string; s3Key: string; expiresIn: number }> {
    return this.request("POST", "/api/v1/files", args);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private injectModel<T extends object>(args: T): T & {
    model?: { provider: string; model: string; apiKey: string };
  } {
    type Augmented = T & { model?: { provider: string; model: string; apiKey: string } };
    // Don't override if the caller explicitly passed `model` in args.
    if ("model" in args && (args as { model?: unknown }).model) return args as Augmented;
    if (this.cfg.providerKey && this.cfg.model) {
      return {
        ...args,
        model: {
          provider: this.cfg.provider,
          model: this.cfg.model,
          apiKey: this.cfg.providerKey,
        },
      };
    }
    // Google fallback path — the v1 endpoint will use the server's GOOGLE_API_KEY.
    return args as Augmented;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.cfg.apiBaseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: "application/json",
      ...(extraHeaders || {}),
    };
    if (body !== undefined && method !== "GET") headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
    });

    let parsed: unknown = null;
    try { parsed = await res.json(); } catch { /* not JSON or empty body */ }

    if (!res.ok) throw buildApiError(res.status, parsed);
    return parsed as T;
  }
}
