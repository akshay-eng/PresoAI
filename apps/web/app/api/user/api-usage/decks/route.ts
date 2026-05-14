/**
 * GET /api/user/api-usage/decks?cursor=&limit=&source=api|mcp|all
 *
 * Paginated list of decks generated via REST API or MCP for the signed-in
 * user. Includes the latest presentation's S3 key + a fresh presigned
 * download URL so the table can render direct download buttons.
 *
 * Response: { items: [...], nextCursor, hasMore }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 100);
    const cursor = url.searchParams.get("cursor") || undefined;
    const sourceFilter = (url.searchParams.get("source") || "all").toLowerCase();
    const allowedSources =
      sourceFilter === "api" ? ["api"] :
      sourceFilter === "mcp" ? ["mcp"] :
      ["api", "mcp"];

    const projects = await prisma.project.findMany({
      where: { userId, source: { in: allowedSources } },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        presentations: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true, s3Key: true, slideCount: true, version: true, createdAt: true },
        },
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, currentPhase: true, completedAt: true, input: true },
        },
      },
    });

    const hasMore = projects.length > limit;
    const sliced = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

    const items = await Promise.all(
      sliced.map(async (p) => {
        const latest = p.presentations[0];
        const job = p.jobs[0];
        const engine = (() => {
          const input = job?.input as Record<string, unknown> | null;
          return (input?.engine as string) || null;
        })();

        let downloadUrl: string | null = null;
        if (latest?.s3Key) {
          try {
            downloadUrl = await getPresignedDownloadUrl(latest.s3Key, 3600);
          } catch {
            downloadUrl = null;
          }
        }

        return {
          deckId: p.id,
          name: p.name,
          prompt: p.prompt.slice(0, 240),
          source: p.source,
          numSlides: latest?.slideCount ?? p.numSlides,
          engine,
          status: job?.status || "UNKNOWN",
          audienceType: p.audienceType,
          createdAt: p.createdAt.toISOString(),
          presentationId: latest?.id ?? null,
          version: latest?.version ?? null,
          downloadUrl,
          apiKeyId: p.apiKeyId,
        };
      })
    );

    return NextResponse.json({ items, nextCursor, hasMore });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
