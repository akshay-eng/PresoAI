import { NextRequest } from "next/server";
import { prisma } from "@slideforge/db";
import { auth } from "@/lib/auth";
import { createSubscriber } from "@/lib/redis";
import { logger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !(session.user as { id?: string }).id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const userId = (session.user as { id: string }).id;

  const job = await prisma.job.findFirst({
    where: { id, userId },
  });

  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const channel = `job:${id}:progress`;
  const subscriber = createSubscriber();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // stream closed
        }
      }

      // Send current status immediately
      send(
        JSON.stringify({
          phase: job.currentPhase || "pending",
          progress: job.progress,
          message: `Current status: ${job.status}`,
        })
      );

      // If already complete or failed, close immediately
      if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
        send(
          JSON.stringify({
            phase: job.status === "COMPLETED" ? "complete" : "failed",
            progress: 1.0,
            message: job.status === "COMPLETED" ? "Complete" : job.error || "Failed",
            data: job.output,
          })
        );
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
              controller.close();
            }, 500);
          }
        } catch {
          // ignore parse errors
        }
      });

      subscriber.subscribe(channel).catch((err) => {
        logger.error({ error: (err as Error).message }, "Failed to subscribe");
        controller.close();
      });

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Cleanup when client disconnects
      _request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        subscriber.disconnect();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
