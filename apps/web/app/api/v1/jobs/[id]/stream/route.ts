/**
 * GET /v1/jobs/[id]/stream
 *
 * Server-Sent Events stream of progress events for a job. The same Redis
 * pubsub channel the dashboard UI consumes — agents can plug straight in.
 *
 * Each event is a single line `data: {...}\n\n` where the JSON has
 * { phase, progress, message, data? }. The stream terminates with a
 * `phase: "complete"` (success) or `phase: "failed"` event.
 *
 * Heartbeat: a comment line (`: heartbeat`) is sent every 15s so corporate
 * proxies don't kill the connection.
 *
 * NOTE: SSE responses bypass `withApiAuth`'s response-shape audit logging
 * (we still authenticate inline, and we emit a single audit row at start).
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@slideforge/db";
import { decrypt } from "@/lib/encryption";
import { createSubscriber } from "@/lib/redis";
import { logger } from "@/lib/logger";

interface Ctx { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  const t0 = Date.now();
  const { id } = await ctx.params;

  // Inline auth (we can't use withApiAuth because it expects a Response, not
  // a long-lived stream — and we want to write the audit row at session start
  // rather than at end-of-stream).
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonError(401, "missing_bearer", "Authorization: Bearer <key> required");
  }
  const presented = authHeader.slice(7).trim();
  if (!presented.startsWith("psf_") || presented.length < 12) {
    return jsonError(401, "invalid_key", "API key is malformed");
  }

  const candidates = await prisma.apiKey.findMany({
    where: { prefix: presented.slice(0, 12) },
  });
  let matched: typeof candidates[number] | null = null;
  for (const k of candidates) {
    let pt: string;
    try { pt = decrypt(k.encryptedKey); } catch { continue; }
    if (pt.length === presented.length && crypto.timingSafeEqual(Buffer.from(pt), Buffer.from(presented))) {
      matched = k;
      break;
    }
  }
  if (!matched) return jsonError(401, "invalid_key", "API key is invalid");
  if (matched.revokedAt) return jsonError(403, "key_revoked", "API key has been revoked");
  if (matched.expiresAt && matched.expiresAt.getTime() < Date.now())
    return jsonError(403, "key_expired", "API key has expired");

  const job = await prisma.job.findFirst({
    where: { id, userId: matched.userId },
  });
  if (!job) return jsonError(404, "job_not_found", "Job not found");

  // Audit log (one row per stream connection — keeps numbers honest).
  void prisma.apiRequestLog.create({
    data: {
      apiKeyId: matched.id,
      userId: matched.userId,
      method: "GET",
      endpoint: "GET /v1/jobs/[id]/stream",
      statusCode: 200,
      latencyMs: Date.now() - t0,
      jobId: job.id,
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent")?.slice(0, 512) || null,
    },
  }).catch(() => undefined);

  const channel = `job:${id}:progress`;
  const subscriber = createSubscriber();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      };

      // Emit a snapshot of the current job state immediately so the client
      // doesn't have to wait for the next pubsub message.
      send(JSON.stringify({
        phase: job.currentPhase || "queued",
        progress: job.progress ?? 0,
        message: `Connected to job ${id}`,
      }));

      // If the job is already terminal, replay the terminal event and close.
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
        send(JSON.stringify({
          phase: job.status === "COMPLETED" ? "complete" : "failed",
          progress: 1.0,
          message: job.status === "COMPLETED" ? "Complete" : (job.error || "Failed"),
          data: job.output,
        }));
        subscriber.disconnect();
        controller.close();
        return;
      }

      subscriber.on("message", (_ch: string, message: string) => {
        send(message);
        try {
          const parsed = JSON.parse(message);
          if (parsed.phase === "complete" || parsed.phase === "failed") {
            setTimeout(() => {
              subscriber.disconnect();
              try { controller.close(); } catch { /* closed */ }
            }, 500);
          }
        } catch { /* not JSON, ignore */ }
      });

      subscriber.subscribe(channel).catch((err) => {
        logger.error({ err: (err as Error).message, jobId: id }, "v1 stream: redis subscribe failed");
        try { controller.close(); } catch { /* closed */ }
      });

      // Keep-alive comments every 15s.
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { clearInterval(heartbeat); }
      }, 15000);

      // Hard cap: drop the connection after 10 minutes regardless. Generation
      // is bounded; if we're past 10 min the worker is wedged and the client
      // should reconnect via /v1/jobs/[id] poll.
      const maxLifetime = setTimeout(() => {
        clearInterval(heartbeat);
        subscriber.disconnect();
        try { controller.close(); } catch { /* closed */ }
      }, 10 * 60 * 1000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        clearTimeout(maxLifetime);
        subscriber.disconnect();
        try { controller.close(); } catch { /* closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering
      "X-API-Version": "v1",
    },
  });
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
