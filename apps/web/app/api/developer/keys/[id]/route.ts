import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * GET /api/developer/keys/[id]
 *   Decrypts and returns the full API key value. Used by the "view" button
 *   in Developer Settings so the user can re-copy a key they've already
 *   generated. Returns 410 Gone if the key has been revoked.
 *
 * DELETE /api/developer/keys/[id]
 *   Hard-deletes the key. (We picked hard delete over soft revoke so users
 *   who want a clean slate get one — the audit trail lives in the request
 *   logs, not in this row.)
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const key = await prisma.apiKey.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    if (key.revokedAt) {
      return NextResponse.json({ error: "Key has been revoked" }, { status: 410 });
    }

    let plaintext: string;
    try {
      plaintext = decrypt(key.encryptedKey);
    } catch (err) {
      logger.error(
        { keyId: id, error: (err as Error).message },
        "API key decrypt failed (likely ENCRYPTION_KEY rotated since creation)"
      );
      return NextResponse.json(
        { error: "This key cannot be decrypted (server encryption key changed). Delete and regenerate." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      id: key.id,
      name: key.name,
      key: plaintext,
      prefix: key.prefix,
      last4: key.last4,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to view API key");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const result = await prisma.apiKey.deleteMany({
      where: { id, userId: session.user.id },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    logger.info({ apiKeyId: id, userId: session.user.id }, "Developer API key deleted");
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to delete API key");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
