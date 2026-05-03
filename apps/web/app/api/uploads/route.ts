import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  deleteS3Object,
  listS3ObjectsByPrefix,
  getPresignedDownloadUrl,
} from "@/lib/s3";

type UploadKind = "image" | "pptx" | "document" | "pdf" | "other";

type UploadItem = {
  id: string;
  source: "user-upload" | "template" | "reference" | "source-file" | "style-source" | "chat-image";
  fileName: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  kind: UploadKind;
  createdAt: string;
  previewUrl: string | null;
  linkedTo: { type: string; id: string; name: string } | null;
  canDelete: boolean;
};

function classify(fileName: string, mimeType: string): UploadKind {
  const lower = fileName.toLowerCase();
  if (mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(lower)) return "image";
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt") || lower.endsWith(".odp")) return "pptx";
  if (lower.endsWith(".docx") || lower.endsWith(".doc") || lower.endsWith(".odt") || lower.endsWith(".txt") || lower.endsWith(".md")) return "document";
  if (lower.endsWith(".pdf")) return "pdf";
  return "other";
}

function guessMimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    odp: "application/vnd.oasis.opendocument.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    txt: "text/plain",
    md: "text/markdown",
  };
  return map[ext] || "application/octet-stream";
}

export async function GET() {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;

    const [userUploads, templates, referenceFiles, sourceFiles, styleSources, chatImageObjects] = await Promise.all([
      prisma.userUpload.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.template.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { projects: { select: { id: true, name: true } } },
      }),
      prisma.referenceFile.findMany({
        where: { project: { userId } },
        orderBy: { createdAt: "desc" },
        include: { project: { select: { id: true, name: true } } },
      }),
      prisma.sourceFile.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.styleProfileSource.findMany({
        where: { styleProfile: { userId } },
        orderBy: { createdAt: "desc" },
        include: { styleProfile: { select: { id: true, name: true } } },
      }),
      listS3ObjectsByPrefix(`uploads/chat-image/${userId}/`).catch((e) => {
        logger.warn({ err: (e as Error).message }, "S3 list chat-image failed");
        return [];
      }),
    ]);

    const items: UploadItem[] = [];

    for (const u of userUploads) {
      items.push({
        id: `user:${u.id}`,
        source: "user-upload",
        fileName: u.fileName,
        s3Key: u.s3Key,
        fileSize: u.fileSize,
        mimeType: u.mimeType,
        kind: classify(u.fileName, u.mimeType),
        createdAt: u.createdAt.toISOString(),
        previewUrl: null,
        linkedTo: null,
        canDelete: true,
      });
    }

    for (const t of templates) {
      const fileName = `${t.name}.pptx`;
      items.push({
        id: `template:${t.id}`,
        source: "template",
        fileName,
        s3Key: t.s3Key,
        fileSize: 0,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        kind: "pptx",
        createdAt: t.createdAt.toISOString(),
        previewUrl: t.thumbnailUrl,
        linkedTo: t.projects[0]
          ? { type: "project", id: t.projects[0].id, name: t.projects[0].name }
          : null,
        canDelete: t.projects.length === 0,
      });
    }

    for (const r of referenceFiles) {
      items.push({
        id: `ref:${r.id}`,
        source: "reference",
        fileName: r.fileName,
        s3Key: r.s3Key,
        fileSize: r.fileSize,
        mimeType: r.fileType,
        kind: classify(r.fileName, r.fileType),
        createdAt: r.createdAt.toISOString(),
        previewUrl: null,
        linkedTo: { type: "project", id: r.project.id, name: r.project.name },
        canDelete: true,
      });
    }

    for (const s of sourceFiles) {
      items.push({
        id: `source:${s.id}`,
        source: "source-file",
        fileName: s.fileName,
        s3Key: s.s3Key,
        fileSize: s.fileSize,
        mimeType: guessMimeFromKey(s.s3Key),
        kind: classify(s.fileName, guessMimeFromKey(s.s3Key)),
        createdAt: s.createdAt.toISOString(),
        previewUrl: null,
        linkedTo: { type: "find", id: s.id, name: "Find sources" },
        canDelete: true,
      });
    }

    for (const sp of styleSources) {
      items.push({
        id: `style:${sp.id}`,
        source: "style-source",
        fileName: sp.fileName,
        s3Key: sp.s3Key,
        fileSize: sp.fileSize,
        mimeType: guessMimeFromKey(sp.s3Key),
        kind: classify(sp.fileName, guessMimeFromKey(sp.s3Key)),
        createdAt: sp.createdAt.toISOString(),
        previewUrl: null,
        linkedTo: { type: "styleProfile", id: sp.styleProfile.id, name: sp.styleProfile.name },
        canDelete: true,
      });
    }

    const knownKeys = new Set(items.map((i) => i.s3Key));
    for (const obj of chatImageObjects) {
      if (knownKeys.has(obj.key)) continue;
      const fileName = obj.key.split("/").pop() || "pasted-image";
      items.push({
        id: `chat:${encodeURIComponent(obj.key)}`,
        source: "chat-image",
        fileName: `Pasted ${fileName}`,
        s3Key: obj.key,
        fileSize: obj.size,
        mimeType: guessMimeFromKey(obj.key),
        kind: "image",
        createdAt: (obj.lastModified ?? new Date()).toISOString(),
        previewUrl: null,
        linkedTo: { type: "chat", id: obj.key, name: "Chat paste" },
        canDelete: true,
      });
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const withUrls = await Promise.all(
      items.map(async (it) => {
        if (it.kind === "image" && !it.previewUrl) {
          try {
            it.previewUrl = await getPresignedDownloadUrl(it.s3Key, 3600);
          } catch {
            it.previewUrl = null;
          }
        }
        return it;
      })
    );

    return NextResponse.json({ items: withUrls });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ err: (err as Error).message }, "Failed to list uploads");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const registerSchema = z.object({
  s3Key: z.string().min(1),
  fileName: z.string().min(1).max(500),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(255),
  purpose: z.enum(["general", "chat-image"]).default("general"),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const expectedPrefix = `uploads/${parsed.data.purpose}/${session.user.id}/`;
    if (!parsed.data.s3Key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "s3Key does not match user/purpose scope" }, { status: 400 });
    }

    const upload = await prisma.userUpload.upsert({
      where: { s3Key: parsed.data.s3Key },
      create: {
        userId: session.user.id,
        s3Key: parsed.data.s3Key,
        fileName: parsed.data.fileName,
        fileSize: parsed.data.fileSize,
        mimeType: parsed.data.mimeType,
        purpose: parsed.data.purpose,
      },
      update: {
        fileName: parsed.data.fileName,
        fileSize: parsed.data.fileSize,
        mimeType: parsed.data.mimeType,
      },
    });

    return NextResponse.json({ id: upload.id }, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ err: (err as Error).message }, "Failed to register upload");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
    }

    const userScopedPrefixes = [
      `uploads/general/${userId}/`,
      `uploads/chat-image/${userId}/`,
      `uploads/template/${userId}/`,
      `uploads/reference/${userId}/`,
      `uploads/find-source/${userId}/`,
    ];
    const ownedByPrefix = userScopedPrefixes.some((p) => key.startsWith(p));

    let dbDeleted = false;

    const userUpload = await prisma.userUpload.findUnique({ where: { s3Key: key } });
    if (userUpload) {
      if (userUpload.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await prisma.userUpload.delete({ where: { id: userUpload.id } });
      dbDeleted = true;
    }

    const template = await prisma.template.findFirst({
      where: { s3Key: key },
      include: { projects: { select: { id: true } } },
    });
    if (template) {
      if (template.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (template.projects.length > 0) {
        return NextResponse.json(
          { error: "Template is in use by a project. Detach it from the project first." },
          { status: 409 }
        );
      }
      await prisma.template.delete({ where: { id: template.id } });
      dbDeleted = true;
    }

    const refFile = await prisma.referenceFile.findFirst({
      where: { s3Key: key },
      include: { project: { select: { userId: true } } },
    });
    if (refFile) {
      if (refFile.project.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await prisma.referenceFile.delete({ where: { id: refFile.id } });
      dbDeleted = true;
    }

    const srcFile = await prisma.sourceFile.findFirst({ where: { s3Key: key } });
    if (srcFile) {
      if (srcFile.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await prisma.sourceFile.delete({ where: { id: srcFile.id } });
      dbDeleted = true;
    }

    const styleSrc = await prisma.styleProfileSource.findFirst({
      where: { s3Key: key },
      include: { styleProfile: { select: { userId: true } } },
    });
    if (styleSrc) {
      if (styleSrc.styleProfile.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await prisma.styleProfileSource.delete({ where: { id: styleSrc.id } });
      dbDeleted = true;
    }

    if (!dbDeleted && !ownedByPrefix) {
      return NextResponse.json({ error: "File not found or not owned by you" }, { status: 404 });
    }

    try {
      await deleteS3Object(key);
    } catch (err) {
      logger.warn({ err: (err as Error).message, key }, "S3 delete failed (DB row already gone)");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ err: (err as Error).message }, "Failed to delete upload");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
