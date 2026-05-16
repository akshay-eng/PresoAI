import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const CATALOG_CATEGORIES = [
  "it",
  "bfsi",
  "consulting",
  "education",
  "healthcare",
  "retail",
  "manufacturing",
  "media",
  "nonprofit",
  "other",
] as const;

const createStyleProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  // Catalog tagging — drives the filter chips on /catalog and lets users
  // discover styles relevant to their industry.
  category: z.enum(CATALOG_CATEGORIES).optional(),
  // When true, this profile appears on the public Catalog for all users to
  // browse + clone. Otherwise it stays private to the creator.
  isPublic: z.boolean().optional().default(false),
});

export async function GET() {
  try {
    const session = await getRequiredSession();

    // Returns the user's own profiles AND the app's global default profiles
    // (IBM, ICICI, Wipro). Globals always come first so they're visible up-top.
    const profiles = await prisma.styleProfile.findMany({
      where: {
        OR: [{ userId: session.user.id }, { isGlobal: true }],
      },
      include: {
        sourceFiles: {
          select: { id: true, fileName: true, status: true, slideCount: true },
        },
        _count: { select: { projects: true } },
      },
      orderBy: [
        { isGlobal: "desc" }, // global profiles first
        { updatedAt: "desc" },
      ],
    });

    return NextResponse.json(profiles);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to list style profiles");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = createStyleProfileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const profile = await prisma.styleProfile.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        isPublic: parsed.data.isPublic ?? false,
        userId: session.user.id,
        status: "pending",
      },
    });

    logger.info({ profileId: profile.id }, "Style profile created");
    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to create style profile");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
