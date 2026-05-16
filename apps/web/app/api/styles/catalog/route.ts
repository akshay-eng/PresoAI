/**
 * GET /api/styles/catalog
 *
 * Lists style profiles visible in the public catalog. A profile is in the
 * catalog when EITHER:
 *   - isGlobal = true   (shipped by us — IBM, ICICI, Wipro, BITS, HDFC, TCS)
 *   - isPublic = true   (user-shared)
 *
 * Query params:
 *   q?         — case-insensitive substring match against name + description
 *   category?  — filter to a single category (it, bfsi, education, …)
 *   limit?     — default 60, max 200
 *   cursor?    — id of the last item from the previous page
 *
 * Auth: session required (anonymous catalogs invite scrapers).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const category = url.searchParams.get("category") || undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "60", 10) || 60, 1), 200);
    const cursor = url.searchParams.get("cursor") || undefined;

    const where: Record<string, unknown> = {
      status: "ready",
      OR: [{ isGlobal: true }, { isPublic: true }],
    };
    if (category && category !== "all") {
      where.category = category;
    }
    if (q) {
      // AND of (isGlobal | isPublic) with name/description match
      where.AND = [
        {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        },
      ];
    }

    const profiles = await prisma.styleProfile.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ isGlobal: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        isGlobal: true,
        isPublic: true,
        themeConfig: true,
        sampleThumbnails: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { clones: true, projects: true } },
      },
    });

    // Distinct categories for the filter-chip UI.
    const catRows = await prisma.styleProfile.groupBy({
      by: ["category"],
      where: { status: "ready", OR: [{ isGlobal: true }, { isPublic: true }] },
      _count: { _all: true },
    });
    const categories = catRows
      .filter((r) => r.category)
      .map((r) => ({ value: r.category as string, count: r._count._all }))
      .sort((a, b) => b.count - a.count);

    const hasMore = profiles.length > limit;
    const sliced = hasMore ? profiles.slice(0, limit) : profiles;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : null;

    // Mark each catalog item with `isInUse` so the UI can render "Used"
    // instead of "Use". A style is in-use for the caller when EITHER:
    //   - it's an isGlobal default (already shows in their style selector)
    //   - they've previously cloned it (clonedFromId matches this item)
    const cloneRows = await prisma.styleProfile.findMany({
      where: {
        userId: session.user.id,
        clonedFromId: { in: sliced.map((p) => p.id) },
      },
      select: { clonedFromId: true },
    });
    const clonedIds = new Set(
      cloneRows.map((r) => r.clonedFromId).filter((x): x is string => !!x),
    );

    return NextResponse.json({
      items: sliced.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        isGlobal: p.isGlobal,
        isPublic: p.isPublic,
        themeConfig: p.themeConfig,
        thumbnails: p.sampleThumbnails,
        cloneCount: p._count.clones,
        projectCount: p._count.projects,
        updatedAt: p.updatedAt.toISOString(),
        isInUse: p.isGlobal || clonedIds.has(p.id),
      })),
      categories,
      nextCursor,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
