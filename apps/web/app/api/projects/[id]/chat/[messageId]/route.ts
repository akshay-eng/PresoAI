/**
 * PATCH /api/projects/[id]/chat/[messageId]
 *
 * Edit the content of a single chat message in place. Used by the inline
 * "Edit & resend" UI on user bubbles. Only the message owner can edit, and
 * only their own user messages — assistant/system messages are immutable
 * (the agent's history shouldn't be rewritable by the user).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const patchSchema = z.object({
  content: z.string().min(1).max(50000),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id, messageId } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    // Verify the user owns this project (and therefore the message).
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Only allow editing the user's own user messages — agent replies and
    // system events are append-only.
    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, projectId: id },
      select: { id: true, role: true },
    });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.role !== "user") {
      return NextResponse.json(
        { error: "Only user messages can be edited" },
        { status: 403 }
      );
    }

    await prisma.chatMessage.update({
      where: { id: messageId },
      data: { content: parsed.data.content },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to patch chat message");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
