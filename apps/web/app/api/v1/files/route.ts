/**
 * POST /v1/files — Upload a reference deck (.pptx) or image (.png/.jpg/.webp)
 * for use in subsequent /v1/decks calls.
 *
 * Two ingestion modes:
 *   1) Direct multipart upload  (Content-Type: multipart/form-data; field "file")
 *      We stream the bytes to MinIO and return the resulting s3_key.
 *   2) Presigned URL request    (Content-Type: application/json + body { fileName, contentType, purpose })
 *      We mint a short-lived PUT URL the client uploads to directly. Better
 *      for large files because we don't proxy them through Next.js.
 *
 * Response (200):
 *   Direct mode:    { s3Key, fileName, fileSize, fileType }
 *   Presigned mode: { uploadUrl, s3Key, expiresIn }
 *
 * Hard caps: 25 MB for direct uploads (proxy mode), 100 MB for presigned.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET, getPresignedUploadUrl } from "@/lib/s3";
import { withApiAuth, jsonError } from "@/lib/v1-auth";
import { logger } from "@/lib/logger";

const PURPOSES = ["reference", "chat-image", "template"] as const;
type Purpose = (typeof PURPOSES)[number];

const ALLOWED_TYPES: Record<Purpose, RegExp[]> = {
  reference: [
    /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/, // .pptx
    /^application\/pdf$/,
    /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,    // .docx
  ],
  "chat-image": [/^image\/(png|jpe?g|webp|gif)$/],
  template: [/^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/],
};

const EXT_BY_TYPE: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const PROXY_MAX_BYTES = 25 * 1024 * 1024;     // 25 MB direct
const PRESIGNED_MAX_BYTES = 100 * 1024 * 1024; // 100 MB presigned

const presignBodySchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200),
  purpose: z.enum(PURPOSES).default("reference"),
  fileSize: z.number().int().positive().max(PRESIGNED_MAX_BYTES).optional(),
});

export const POST = withApiAuth(
  { endpoint: "POST /v1/files" },
  async (request, ctx) => {
    const contentType = request.headers.get("content-type") || "";

    // ── JSON path: client wants a presigned URL ───────────────────────────
    if (contentType.includes("application/json")) {
      let body: unknown;
      try { body = await request.json(); } catch {
        return jsonError(400, "invalid_json", "Request body must be valid JSON");
      }
      const parsed = presignBodySchema.safeParse(body);
      if (!parsed.success) {
        return jsonError(400, "validation_failed", "Invalid request body", parsed.error.flatten());
      }
      if (!isAllowed(parsed.data.contentType, parsed.data.purpose)) {
        return jsonError(415, "unsupported_media_type", `Content-Type "${parsed.data.contentType}" is not allowed for purpose "${parsed.data.purpose}"`);
      }
      const s3Key = mintKey(ctx.user.id, parsed.data.purpose, parsed.data.contentType);
      const uploadUrl = await getPresignedUploadUrl(s3Key, parsed.data.contentType, 600);
      return NextResponse.json({ uploadUrl, s3Key, expiresIn: 600 });
    }

    // ── multipart path: proxy upload through Next.js ──────────────────────
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      if (!form) return jsonError(400, "invalid_form", "Could not parse multipart body");

      const file = form.get("file");
      const purposeRaw = (form.get("purpose") as string | null) || "reference";
      if (!(file instanceof File)) {
        return jsonError(400, "missing_file", "Field `file` is required");
      }
      const purpose = (PURPOSES as readonly string[]).includes(purposeRaw)
        ? (purposeRaw as Purpose)
        : "reference";

      if (file.size > PROXY_MAX_BYTES) {
        return jsonError(
          413,
          "file_too_large",
          `Direct upload limited to ${Math.floor(PROXY_MAX_BYTES / 1024 / 1024)} MB. Use the presigned-URL flow for larger files (POST JSON instead of multipart).`,
        );
      }
      if (!isAllowed(file.type, purpose)) {
        return jsonError(415, "unsupported_media_type", `Content-Type "${file.type}" is not allowed for purpose "${purpose}"`);
      }

      const s3Key = mintKey(ctx.user.id, purpose, file.type, file.name);
      const buffer = Buffer.from(await file.arrayBuffer());

      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: file.type,
        }));
      } catch (err) {
        logger.error({ err: (err as Error).message, s3Key }, "v1 file upload failed");
        return jsonError(500, "upload_failed", "Failed to store the uploaded file");
      }

      return NextResponse.json({
        s3Key,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        purpose,
      });
    }

    return jsonError(
      415,
      "unsupported_content_type",
      "Use Content-Type: multipart/form-data (with field `file`) for direct uploads, or application/json for a presigned URL.",
    );
  },
);

function isAllowed(contentType: string, purpose: Purpose): boolean {
  const patterns = ALLOWED_TYPES[purpose];
  return patterns.some((re) => re.test(contentType.split(";")[0]?.trim() || ""));
}

function mintKey(userId: string, purpose: Purpose, contentType: string, fileName?: string): string {
  const base = (contentType.split(";")[0] || "").trim();
  const ext = EXT_BY_TYPE[base] || (fileName?.split(".").pop()?.toLowerCase() || "bin");
  const folder = purpose === "chat-image" ? "uploads/chat-image" : `uploads/${purpose}`;
  const id = crypto.randomUUID();
  return `${folder}/${userId}/${id}.${ext}`;
}
