import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { createProjectSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

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
      },
    });

    const hasMore = projects.length > limit;
    const items = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

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

    const project = await prisma.project.create({
      data: {
        ...parsed.data,
        userId: session.user.id,
      },
      include: {
        template: true,
      },
    });

    logger.info({ projectId: project.id }, "Project created");
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to create project");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
