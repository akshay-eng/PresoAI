/**
 * GET /api/user/api-usage/summary
 *
 * Counters for the API-usage dashboard. Scoped to the signed-in user's keys.
 *
 * Response:
 *   {
 *     requests:  { today, last7d, last30d, total },
 *     successRate: number,   // 0-1 over last 30d
 *     errorCount: number,    // >=400 status over last 30d
 *     avgLatencyMs: number | null,  // over last 30d
 *     decks: { last30d, total },
 *     keys:  { active, expiringSoon },
 *   }
 */
import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;
    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since7d = new Date(now - 7 * DAY_MS);
    const since30d = new Date(now - 30 * DAY_MS);
    const soon = new Date(now + 7 * DAY_MS);

    const [
      reqToday,
      req7d,
      req30d,
      reqTotal,
      errs30d,
      latencyAgg,
      decks30d,
      decksTotal,
      keysActive,
      keysExpiringSoon,
    ] = await Promise.all([
      prisma.apiRequestLog.count({ where: { userId, createdAt: { gte: since24h } } }),
      prisma.apiRequestLog.count({ where: { userId, createdAt: { gte: since7d } } }),
      prisma.apiRequestLog.count({ where: { userId, createdAt: { gte: since30d } } }),
      prisma.apiRequestLog.count({ where: { userId } }),
      prisma.apiRequestLog.count({
        where: { userId, createdAt: { gte: since30d }, statusCode: { gte: 400 } },
      }),
      prisma.apiRequestLog.aggregate({
        where: { userId, createdAt: { gte: since30d } },
        _avg: { latencyMs: true },
      }),
      prisma.project.count({
        where: { userId, source: { in: ["api", "mcp"] }, createdAt: { gte: since30d } },
      }),
      prisma.project.count({ where: { userId, source: { in: ["api", "mcp"] } } }),
      prisma.apiKey.count({ where: { userId, revokedAt: null } }),
      prisma.apiKey.count({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { not: null, lte: soon, gte: new Date() },
        },
      }),
    ]);

    const successRate = req30d === 0 ? 1 : 1 - errs30d / req30d;

    return NextResponse.json({
      requests: { today: reqToday, last7d: req7d, last30d: req30d, total: reqTotal },
      successRate,
      errorCount: errs30d,
      avgLatencyMs: latencyAgg._avg.latencyMs ? Math.round(latencyAgg._avg.latencyMs) : null,
      decks: { last30d: decks30d, total: decksTotal },
      keys: { active: keysActive, expiringSoon: keysExpiringSoon },
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
