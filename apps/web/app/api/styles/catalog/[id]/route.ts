/**
 * GET /api/styles/catalog/[id]
 *
 * Full detail of a catalog style. Includes style-guide prose, layout
 * patterns, theme config, and any sample thumbnails so the catalog
 * detail modal can show what the style actually looks like.
 *
 * Auth: session required. Only visible profiles (isGlobal OR isPublic) are
 * returned — private profiles 404 even if the caller knows the id.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const profile = await prisma.styleProfile.findFirst({
      where: {
        id,
        status: "ready",
        OR: [{ isGlobal: true }, { isPublic: true }],
      },
      include: {
        _count: { select: { clones: true, projects: true } },
      },
    });

    if (!profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Same "in use" semantics as the list endpoint.
    let isInUse = profile.isGlobal;
    if (!isInUse) {
      const userClone = await prisma.styleProfile.findFirst({
        where: { userId: session.user.id, clonedFromId: profile.id },
        select: { id: true },
      });
      isInUse = !!userClone;
    }

    return NextResponse.json({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      category: profile.category,
      isGlobal: profile.isGlobal,
      isPublic: profile.isPublic,
      themeConfig: profile.themeConfig,
      visualStyle: profile.visualStyle,
      styleGuide: profile.styleGuide,
      layoutPatterns: profile.layoutPatterns,
      thumbnails: profile.sampleThumbnails,
      cloneCount: profile._count.clones,
      projectCount: profile._count.projects,
      updatedAt: profile.updatedAt.toISOString(),
      isInUse,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
