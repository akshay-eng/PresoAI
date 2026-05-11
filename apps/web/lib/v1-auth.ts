/**
 * Shared auth + rate-limit + audit-logging middleware for the public /v1 API.
 *
 * Every v1 route wraps its handler in `withApiAuth`. The wrapper:
 *   1. Verifies `Authorization: Bearer psf_…` against the api_keys table
 *      (decrypts and matches against encryptedKey). Constant-time path.
 *   2. Rejects revoked, expired, or unentitled keys with consistent 401/403.
 *   3. Enforces a Redis sliding-window rate limit per key. Two budgets: a
 *      generic per-minute budget and a tighter per-hour budget for jobs that
 *      kick off paid generation.
 *   4. Fire-and-forget writes a row to api_request_log AFTER the response
 *      so analytics never blocks the hot path.
 *   5. Updates api_keys.lastUsedAt opportunistically (debounced via Redis).
 *
 * The handler receives a typed context: { apiKey, user } plus a setter for
 * the response's job id (so deck-create can surface the new job to the audit
 * log without exposing it back to handlers as a prop).
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@slideforge/db";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiAuthContext {
  apiKey: {
    id: string;
    name: string;
    userId: string;
    prefix: string;
  };
  user: {
    id: string;
    email: string;
    role: "USER" | "ADMIN";
  };
  // Handlers call this when they create a job so the audit row links to it.
  setJobId: (id: string) => void;
}

export interface RateLimitConfig {
  /** Per-minute requests for the bearer key. Default 60. */
  perMinute?: number;
  /** Per-hour requests for the bearer key. Default 600. */
  perHour?: number;
  /** Optional tighter budget for expensive endpoints (e.g. deck create). */
  expensivePerHour?: number;
}

const DEFAULT_LIMITS: Required<Omit<RateLimitConfig, "expensivePerHour">> & { expensivePerHour: number | null } = {
  perMinute: 60,
  perHour: 600,
  expensivePerHour: 10, // for deck create / edit
};

// ─── Public wrapper ──────────────────────────────────────────────────────────

type Handler = (
  request: NextRequest,
  ctx: ApiAuthContext,
) => Promise<Response> | Response;

export interface WithApiAuthOptions {
  /** Endpoint label used for rate-limit bucketing + audit log. */
  endpoint: string;
  /** When true, count this call against the expensivePerHour budget. */
  expensive?: boolean;
  /** Optional override for the per-key limits. */
  limits?: RateLimitConfig;
}

export function withApiAuth(opts: WithApiAuthOptions, handler: Handler) {
  return async function wrapped(request: NextRequest): Promise<Response> {
    const t0 = Date.now();

    // Capture metadata up-front; fall back to "" so audit log writes are stable.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "";
    const userAgent = request.headers.get("user-agent") || "";
    const method = request.method;

    // Bind a mutable jobId capture so the handler can surface its new job id
    // into the audit row without changing the handler return contract.
    let capturedJobId: string | null = null;

    let response: Response;
    let apiKeyId: string | null = null;
    let userId: string | null = null;
    let errorCode: string | null = null;

    try {
      const auth = request.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) {
        response = unauthorized("missing_bearer", "Authorization: Bearer <key> required");
        errorCode = "missing_bearer";
      } else {
        const presented = auth.slice("Bearer ".length).trim();
        const verify = await verifyApiKey(presented);

        if (!verify.ok) {
          response = unauthorized(verify.code, verify.message);
          errorCode = verify.code;
        } else {
          apiKeyId = verify.key.id;
          userId = verify.user.id;

          const limited = await enforceRateLimit(verify.key.id, opts);
          if (limited) {
            response = limited;
            errorCode = "rate_limited";
          } else {
            const ctx: ApiAuthContext = {
              apiKey: {
                id: verify.key.id,
                name: verify.key.name,
                userId: verify.key.userId,
                prefix: verify.key.prefix,
              },
              user: {
                id: verify.user.id,
                email: verify.user.email,
                role: verify.user.role,
              },
              setJobId: (id: string) => {
                capturedJobId = id;
              },
            };

            // Bump lastUsedAt at most once a minute per key (debounced via Redis).
            void touchLastUsedAt(verify.key.id);

            // Run the actual handler.
            try {
              response = await handler(request, ctx);
            } catch (err) {
              logger.error(
                { err: (err as Error).message, stack: (err as Error).stack, endpoint: opts.endpoint },
                "v1 handler threw"
              );
              errorCode = "internal_error";
              response = jsonError(500, "internal_error", "Internal server error");
            }
          }
        }
      }
    } catch (err) {
      logger.error(
        { err: (err as Error).message, endpoint: opts.endpoint },
        "withApiAuth failed before handler"
      );
      errorCode = "internal_error";
      response = jsonError(500, "internal_error", "Internal server error");
    }

    // Surface basic rate-limit + version headers on every response.
    response.headers.set("X-API-Version", "v1");

    // Fire-and-forget audit log. We measure latency at this point.
    const latencyMs = Date.now() - t0;
    void writeAuditLog({
      apiKeyId,
      userId,
      method,
      endpoint: opts.endpoint,
      statusCode: response.status,
      latencyMs,
      jobId: capturedJobId,
      errorCode,
      ip,
      userAgent,
      requestSize: parseInt(request.headers.get("content-length") || "0", 10) || null,
      responseSize: parseInt(response.headers.get("content-length") || "0", 10) || null,
    });

    return response;
  };
}

// ─── Auth verification ──────────────────────────────────────────────────────

interface VerifySuccess {
  ok: true;
  key: { id: string; name: string; userId: string; prefix: string };
  user: { id: string; email: string; role: "USER" | "ADMIN" };
}
interface VerifyFailure { ok: false; code: string; message: string }

async function verifyApiKey(presented: string): Promise<VerifySuccess | VerifyFailure> {
  // Validate shape first — psf_ prefix + at least 8 chars after.
  if (!presented.startsWith("psf_") || presented.length < 12) {
    return { ok: false, code: "invalid_key", message: "API key is malformed" };
  }
  const prefix = presented.slice(0, 12);

  // Index lookup by prefix is fast; we may get >1 row in the (extremely
  // unlikely) event of a prefix collision, so we decrypt all candidates.
  const candidates = await prisma.apiKey.findMany({
    where: { prefix },
    include: { user: { select: { id: true, email: true, role: true } } },
  });

  let matched: typeof candidates[number] | null = null;
  for (const k of candidates) {
    let plaintext: string;
    try {
      plaintext = decrypt(k.encryptedKey);
    } catch {
      // Could not decrypt (key rotation); skip silently.
      continue;
    }
    if (constantTimeEq(plaintext, presented)) {
      matched = k;
      break;
    }
  }
  if (!matched) {
    return { ok: false, code: "invalid_key", message: "API key is invalid" };
  }
  if (matched.revokedAt) {
    return { ok: false, code: "key_revoked", message: "API key has been revoked" };
  }
  if (matched.expiresAt && matched.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: "key_expired", message: "API key has expired" };
  }

  // Entitlement: user must have a redeemed coupon OR at least one stored
  // provider key. Mirrors the gate in /api/projects/[id]/generate.
  const [providerCount, coupon] = await Promise.all([
    prisma.providerApiKey.count({
      where: { userId: matched.userId, isValid: true },
    }),
    prisma.user.findUnique({
      where: { id: matched.userId },
      select: { couponCode: true, role: true, email: true },
    }),
  ]);
  const hasEntitlement = !!coupon?.couponCode || providerCount > 0;
  if (!hasEntitlement) {
    return {
      ok: false,
      code: "entitlement_required",
      message:
        "This account has no provider API key configured and no redeemed coupon. " +
        "Add a provider key in Settings → API Keys, or redeem a coupon, then retry.",
    };
  }

  return {
    ok: true,
    key: {
      id: matched.id,
      name: matched.name,
      userId: matched.userId,
      prefix: matched.prefix,
    },
    user: {
      id: matched.userId,
      email: coupon?.email || matched.user?.email || "",
      role: (coupon?.role || matched.user?.role || "USER") as "USER" | "ADMIN",
    },
  };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

async function enforceRateLimit(
  apiKeyId: string,
  opts: WithApiAuthOptions,
): Promise<Response | null> {
  const cfg = {
    perMinute: opts.limits?.perMinute ?? DEFAULT_LIMITS.perMinute,
    perHour: opts.limits?.perHour ?? DEFAULT_LIMITS.perHour,
    expensivePerHour: opts.limits?.expensivePerHour ?? DEFAULT_LIMITS.expensivePerHour,
  };

  // Lazy redis import — keeps client bundles slim.
  let connection: import("ioredis").default;
  try {
    connection = (await import("@slideforge/queue")).connection as unknown as import("ioredis").default;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "rate-limit: redis unavailable, allowing request");
    return null;
  }

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const hourBucket = Math.floor(now / 3_600_000);

  const minuteKey = `rl:m:${apiKeyId}:${minuteBucket}`;
  const hourKey = `rl:h:${apiKeyId}:${hourBucket}`;

  // Single round-trip: two INCRs + their EXPIREs.
  // Returns: [minuteCount, _, hourCount, _]
  const pipeline = connection.multi();
  pipeline.incr(minuteKey);
  pipeline.expire(minuteKey, 70);
  pipeline.incr(hourKey);
  pipeline.expire(hourKey, 3700);

  let minuteCount = 0;
  let hourCount = 0;
  try {
    const replies = (await pipeline.exec()) || [];
    minuteCount = (replies[0]?.[1] as number) || 0;
    hourCount = (replies[2]?.[1] as number) || 0;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "rate-limit: pipeline failed, allowing request");
    return null;
  }

  let expensiveCount = 0;
  if (opts.expensive && cfg.expensivePerHour) {
    const expensiveKey = `rl:eh:${apiKeyId}:${hourBucket}`;
    try {
      const r = await connection.multi().incr(expensiveKey).expire(expensiveKey, 3700).exec();
      expensiveCount = (r?.[0]?.[1] as number) || 0;
    } catch {
      // Ignore — fall through.
    }
  }

  // Decide.
  const exceedsMinute = minuteCount > cfg.perMinute;
  const exceedsHour = hourCount > cfg.perHour;
  const exceedsExpensive = !!opts.expensive && cfg.expensivePerHour !== null
    && expensiveCount > cfg.expensivePerHour;

  if (exceedsMinute || exceedsHour || exceedsExpensive) {
    const which = exceedsExpensive ? "expensive" : exceedsMinute ? "per_minute" : "per_hour";
    const resetSec = exceedsMinute
      ? 60 - Math.floor((now % 60_000) / 1000)
      : 3600 - Math.floor((now % 3_600_000) / 1000);
    const res = jsonError(429, "rate_limited", `Rate limit exceeded (${which}). Retry in ${resetSec}s.`);
    res.headers.set("Retry-After", String(resetSec));
    res.headers.set("X-RateLimit-Limit-Minute", String(cfg.perMinute));
    res.headers.set("X-RateLimit-Remaining-Minute", String(Math.max(0, cfg.perMinute - minuteCount)));
    res.headers.set("X-RateLimit-Limit-Hour", String(cfg.perHour));
    res.headers.set("X-RateLimit-Remaining-Hour", String(Math.max(0, cfg.perHour - hourCount)));
    return res;
  }

  return null;
}

// ─── Last-used touch (debounced) ────────────────────────────────────────────

async function touchLastUsedAt(apiKeyId: string): Promise<void> {
  try {
    const { connection } = await import("@slideforge/queue");
    const guard = `lu:${apiKeyId}`;
    const set = await (connection as unknown as import("ioredis").default).set(guard, "1", "EX", 60, "NX");
    if (set !== "OK") return;
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    /* lastUsedAt is best-effort; never fail the request because of it */
  }
}

// ─── Audit log writer ───────────────────────────────────────────────────────

interface AuditRow {
  apiKeyId: string | null;
  userId: string | null;
  method: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  jobId: string | null;
  errorCode: string | null;
  ip: string;
  userAgent: string;
  requestSize: number | null;
  responseSize: number | null;
}

async function writeAuditLog(row: AuditRow): Promise<void> {
  try {
    await prisma.apiRequestLog.create({
      data: {
        apiKeyId: row.apiKeyId,
        userId: row.userId,
        method: row.method,
        endpoint: row.endpoint,
        statusCode: row.statusCode,
        latencyMs: row.latencyMs,
        jobId: row.jobId,
        errorCode: row.errorCode,
        ip: row.ip || null,
        userAgent: row.userAgent ? row.userAgent.slice(0, 512) : null,
        requestSize: row.requestSize,
        responseSize: row.responseSize,
      },
    });
  } catch (err) {
    // Never let audit failures cascade into the response path.
    logger.warn({ err: (err as Error).message }, "audit log write failed");
  }
}

// ─── Response helpers ───────────────────────────────────────────────────────

export function jsonError(status: number, code: string, message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

function unauthorized(code: string, message: string): NextResponse {
  // Same status (401) for every auth failure mode — never leak which check failed.
  // The structured `code` is informational only. Treat key_revoked / key_expired
  // as 403 because the client genuinely sent a key, but it's not currently valid.
  if (code === "key_revoked" || code === "key_expired" || code === "entitlement_required") {
    return jsonError(403, code, message);
  }
  return jsonError(401, code, message);
}

// ─── Idempotency-key helpers (used by POST /v1/decks) ───────────────────────

/**
 * Returns the cached response body for an idempotency key, or null.
 * The handler is responsible for STORING with `storeIdempotent` after success.
 */
export async function loadIdempotent(apiKeyId: string, idemKey: string | null): Promise<unknown | null> {
  if (!idemKey) return null;
  try {
    const { connection } = await import("@slideforge/queue");
    const cached = await (connection as unknown as import("ioredis").default).get(
      `idem:${apiKeyId}:${idemKey}`,
    );
    if (!cached) return null;
    return JSON.parse(cached);
  } catch {
    return null;
  }
}

export async function storeIdempotent(apiKeyId: string, idemKey: string | null, body: unknown): Promise<void> {
  if (!idemKey) return;
  try {
    const { connection } = await import("@slideforge/queue");
    await (connection as unknown as import("ioredis").default).set(
      `idem:${apiKeyId}:${idemKey}`,
      JSON.stringify(body),
      "EX",
      60 * 60 * 24, // 24h
    );
  } catch {
    /* ignore */
  }
}
