/**
 * Project Memory API
 *
 *   GET    /api/projects/:id/memory   — fetch the raw memory row
 *   DELETE /api/projects/:id/memory   — wipe memory (user-initiated reset)
 *
 * Auth: session-required. Only the project owner can read or wipe.
 *
 * The agent reads memory directly from the DB inside the python worker — this
 * endpoint exists for the web UI to inspect/reset state.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, memory: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Cold start — no memory row exists yet. Return an empty shape so the
    // client doesn't have to special-case null.
    if (!project.memory) {
      return NextResponse.json({
        entities: [],
        decisions: [],
        outlines: [],
        edits: [],
        preferences: {},
        narrative: "",
        version: 0,
        empty: true,
      });
    }

    return NextResponse.json({
      entities: project.memory.entities ?? [],
      decisions: project.memory.decisions ?? [],
      outlines: project.memory.outlines ?? [],
      edits: project.memory.edits ?? [],
      preferences: project.memory.preferences ?? {},
      narrative: project.memory.narrative ?? "",
      version: project.memory.version ?? 0,
      updatedAt: project.memory.updatedAt,
      empty: false,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to load project memory");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    await prisma.projectMemory.deleteMany({ where: { projectId: id } });
    logger.info({ projectId: id }, "Project memory wiped by user");

    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete project memory");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
