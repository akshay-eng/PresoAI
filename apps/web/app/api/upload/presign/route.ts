import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { presignUploadSchema } from "@slideforge/shared";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedUploadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = presignUploadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { fileName, contentType, purpose } = parsed.data;
    const fileId = crypto.randomUUID();
    const ext = fileName.split(".").pop() || "bin";
    const key = `uploads/${purpose}/${session.user.id}/${fileId}.${ext}`;
    const expiresIn = 600;

    const signedUrl = await getPresignedUploadUrl(key, contentType, expiresIn);

    logger.info({ key, purpose }, "Presigned upload URL generated");

    return NextResponse.json({
      signedUrl,
      key,
      expiresIn,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to generate presigned URL");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
