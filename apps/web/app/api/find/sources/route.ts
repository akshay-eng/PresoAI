import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const session = await getRequiredSession();
    const items = await prisma.sourceFile.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to list source files");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Register one or more uploaded files (already pushed to S3 via presigned PUT).
// Body: { files: [{ fileName, s3Key, fileSize }] }
export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = (await request.json()) as {
      files?: Array<{ fileName: string; s3Key: string; fileSize: number }>;
    };
    const files = body.files || [];
    if (files.length === 0) {
      return NextResponse.json({ error: "no files supplied" }, { status: 400 });
    }

    const created = await prisma.$transaction(
      files.map((f) =>
        prisma.sourceFile.create({
          data: {
            userId: session.user.id,
            fileName: f.fileName,
            s3Key: f.s3Key,
            fileSize: f.fileSize,
            status: "pending",
          },
        })
      )
    );

    // Fire-and-forget kick off indexing for each.
    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    for (const sf of created) {
      void (async () => {
        try {
          await prisma.sourceFile.update({
            where: { id: sf.id },
            data: { status: "indexing" },
          });
          const res = await fetch(`${pythonAgentUrl}/find/index-pptx`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: sf.userId,
              source_file_id: sf.id,
              s3_key: sf.s3Key,
              thumbnail_prefix: `find/${sf.userId}/${sf.id}`,
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`indexer responded ${res.status}: ${text.slice(0, 200)}`);
          }
          const data = (await res.json()) as { slide_count?: number; indexed?: number };
          await prisma.sourceFile.update({
            where: { id: sf.id },
            data: {
              status: "ready",
              slideCount: data.slide_count ?? null,
              indexedAt: new Date(),
              error: null,
            },
          });
          logger.info({ id: sf.id, slides: data.slide_count }, "Source file indexed");
        } catch (err) {
          const msg = (err as Error).message;
          logger.error({ id: sf.id, error: msg }, "Indexing failed");
          await prisma.sourceFile.update({
            where: { id: sf.id },
            data: { status: "failed", error: msg.slice(0, 500) },
          });
        }
      })();
    }

    return NextResponse.json({ items: created });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to register source files");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
