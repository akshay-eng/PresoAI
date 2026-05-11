import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { createProjectSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";
import { summarizeForName } from "@/lib/llm-naming";

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const search = searchParams.get("search");

    const where: Record<string, unknown> = { userId: session.user.id };
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const projects = await prisma.project.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        template: { select: { id: true, name: true, thumbnailUrl: true } },
        _count: { select: { presentations: true, referenceFiles: true } },
        presentations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { thumbnails: true, slideCount: true },
        },
      },
    });

    const hasMore = projects.length > limit;
    const sliced = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

    const items = await Promise.all(
      sliced.map(async (p) => {
        const latest = p.presentations?.[0];
        const keys = Array.isArray(latest?.thumbnails) ? (latest!.thumbnails as string[]) : [];
        const thumbnailUrls = await Promise.all(
          keys.slice(0, 8).map(async (k) => {
            try { return await getPresignedDownloadUrl(k, 3600); } catch { return null; }
          })
        );
        const { presentations: _omit, ...rest } = p;
        return { ...rest, thumbnailUrls: thumbnailUrls.filter(Boolean) as string[] };
      })
    );

    return NextResponse.json({
      items,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to list projects");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = createProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Generate a short, descriptive project name from the user's prompt
    // before persisting — so the dashboard / project page never displays the
    // truncated 60-char raw prompt. We tolerate failures: if naming returns
    // null (timeout / no API key / etc) we fall back to whatever name the
    // client sent (which is the truncated prompt).
    let resolvedName = parsed.data.name;
    if (parsed.data.prompt && parsed.data.prompt.length > 0) {
      try {
        const nice = await summarizeForName(parsed.data.prompt, "project");
        if (nice && nice.length >= 2) resolvedName = nice;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          "Project name summarization failed, keeping raw name"
        );
      }
    }

    const project = await prisma.project.create({
      data: {
        ...parsed.data,
        name: resolvedName,
        userId: session.user.id,
      },
      include: {
        template: true,
      },
    });

    logger.info({ projectId: project.id, name: resolvedName }, "Project created");
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to create project");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
