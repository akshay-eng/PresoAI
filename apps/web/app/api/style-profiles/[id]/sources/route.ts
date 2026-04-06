import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const addSourceSchema = z.object({
  s3Key: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = addSourceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const profile = await prisma.styleProfile.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const source = await prisma.styleProfileSource.create({
      data: {
        styleProfileId: id,
        fileName: parsed.data.fileName,
        s3Key: parsed.data.s3Key,
        fileSize: parsed.data.fileSize,
        status: "pending",
      },
    });

    // Reset profile status since new source was added
    await prisma.styleProfile.update({
      where: { id },
      data: { status: "pending" },
    });

    logger.info(
      { profileId: id, sourceId: source.id },
      "Source file added to style profile"
    );

    return NextResponse.json(source, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to add source");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
