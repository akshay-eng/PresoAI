import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * Developer API keys — for calling Preso's public REST API + MCP server.
 *
 * Format:  psf_<24-byte-base32 ≈ 39 chars total>
 *   prefix = first 12 chars (always shown — safe to display)
 *   last4  = last 4 chars (shown after the bullet mask in lists)
 *   full key = encrypted at rest with the same AES helper used for provider keys
 *
 * The full key is shown to the user ONCE at creation, and again on demand
 * when they click "view" (we decrypt on read). This matches the developer
 * UX where you need to copy the key into a config file.
 */

const KEY_PREFIX = "psf_";       // "preso forge"
const KEY_BYTES = 24;            // 192 bits of entropy

function generateKey(): string {
  // base32-ish via base64url is fine; strip padding & non-alpha chars to
  // make the key easy to copy/paste from terminals (no '/+=').
  const raw = crypto.randomBytes(KEY_BYTES).toString("base64url").replace(/[-_]/g, "");
  return KEY_PREFIX + raw.slice(0, 32); // total length ~36
}

const expiryChoices = ["1d", "7d", "30d", "90d", "1y", "never"] as const;
const createSchema = z.object({
  name: z.string().min(1).max(80),
  expiry: z.enum(expiryChoices).default("never"),
});

function expiryToDate(expiry: string): Date | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (expiry) {
    case "1d":  return new Date(now + 1 * day);
    case "7d":  return new Date(now + 7 * day);
    case "30d": return new Date(now + 30 * day);
    case "90d": return new Date(now + 90 * day);
    case "1y":  return new Date(now + 365 * day);
    case "never": return null;
    default: return null;
  }
}

export async function GET() {
  try {
    const session = await getRequiredSession();
    const keys = await prisma.apiKey.findMany({
      where: { userId: session.user.id },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        prefix: true,
        last4: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json(keys);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to list API keys");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const fullKey = generateKey();
    const prefix = fullKey.slice(0, 12);
    const last4 = fullKey.slice(-4);
    const encryptedKey = encrypt(fullKey);
    const expiresAt = expiryToDate(parsed.data.expiry);

    const created = await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name.trim(),
        prefix,
        last4,
        encryptedKey,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        last4: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    logger.info(
      { apiKeyId: created.id, userId: session.user.id, prefix },
      "Developer API key minted"
    );

    // The full key is returned in the response body — this is the only time
    // the client sees it post-creation in the standard flow. The user CAN
    // re-fetch it later via GET /api/developer/keys/[id] (decrypt-on-read).
    return NextResponse.json({ ...created, key: fullKey }, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to create API key");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
