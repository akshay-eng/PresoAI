/**
 * GET /api/user/api-usage/requests?cursor=&limit=&status=success|error|all&keyId=
 *
 * Paginated audit log of the signed-in user's API requests. Powers the
 * "Recent requests" table on /api-usage. Joins to ApiKey to surface the key
 * label (so we don't expose raw key prefixes).
 *
 * Response: { items: [...], nextCursor, hasMore }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;

    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 1), 100);
    const cursor = url.searchParams.get("cursor") || undefined;
    const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();
    const keyId = url.searchParams.get("keyId") || undefined;

    const where: Record<string, unknown> = { userId };
    if (statusFilter === "success") where.statusCode = { lt: 400 };
    else if (statusFilter === "error") where.statusCode = { gte: 400 };
    if (keyId) where.apiKeyId = keyId;

    const rows = await prisma.apiRequestLog.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
    });

    // Resolve key labels in one extra query.
    const keyIds = Array.from(new Set(rows.map((r) => r.apiKeyId).filter(Boolean))) as string[];
    const keys = keyIds.length
      ? await prisma.apiKey.findMany({
          where: { id: { in: keyIds } },
          select: { id: true, name: true, last4: true },
        })
      : [];
    const keyById = new Map(keys.map((k) => [k.id, { name: k.name, last4: k.last4 }]));

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : undefined;

    const items = sliced.map((r) => ({
      id: r.id,
      method: r.method,
      endpoint: r.endpoint,
      statusCode: r.statusCode,
      latencyMs: r.latencyMs,
      jobId: r.jobId,
      errorCode: r.errorCode,
      ip: r.ip,
      keyId: r.apiKeyId,
      keyName: r.apiKeyId ? keyById.get(r.apiKeyId)?.name ?? null : null,
      keyLast4: r.apiKeyId ? keyById.get(r.apiKeyId)?.last4 ?? null : null,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ items, nextCursor, hasMore });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
