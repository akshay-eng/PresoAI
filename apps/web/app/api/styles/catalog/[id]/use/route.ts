/**
 * POST /api/styles/catalog/[id]/use
 *
 * Clones a catalog style into the caller's own style profiles so they can
 * pick it from the project-page selector. We DO NOT just attach the
 * caller as a co-owner of the source — global/public sources are
 * immutable references that other users keep using. Cloning creates an
 * independent copy the user can rename / tweak.
 *
 * The clone is private (isPublic=false) and points back at the source
 * via `clonedFromId` so we can show "based on …" badges + count clone
 * usage on the source.
 *
 * Idempotent: if the user already has a clone of this source, returns
 * that clone instead of creating a duplicate.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const source = await prisma.styleProfile.findFirst({
      where: {
        id,
        status: "ready",
        OR: [{ isGlobal: true }, { isPublic: true }],
      },
    });
    if (!source) {
      return NextResponse.json({ error: "Catalog style not found" }, { status: 404 });
    }

    // Idempotent: don't create a second clone of the same source for the
    // same user. Return whatever's already there.
    const existing = await prisma.styleProfile.findFirst({
      where: {
        userId: session.user.id,
        clonedFromId: source.id,
      },
      select: { id: true, name: true },
    });
    if (existing) {
      logger.info(
        { userId: session.user.id, sourceId: source.id, existingId: existing.id },
        "Catalog style already cloned — returning existing"
      );
      return NextResponse.json({ id: existing.id, name: existing.name, alreadyCloned: true });
    }

    const clone = await prisma.styleProfile.create({
      data: {
        name: source.name,
        description: source.description,
        category: source.category,
        userId: session.user.id,
        isGlobal: false,
        isPublic: false,
        clonedFromId: source.id,
        status: "ready",
        themeConfig: source.themeConfig ?? undefined,
        visualStyle: source.visualStyle ?? undefined,
        styleGuide: source.styleGuide,
        layoutPatterns: source.layoutPatterns ?? undefined,
        sampleThumbnails: source.sampleThumbnails ?? undefined,
      },
      select: { id: true, name: true },
    });

    logger.info(
      { userId: session.user.id, sourceId: source.id, cloneId: clone.id },
      "Catalog style cloned"
    );

    return NextResponse.json({ id: clone.id, name: clone.name, alreadyCloned: false }, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to clone catalog style");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
