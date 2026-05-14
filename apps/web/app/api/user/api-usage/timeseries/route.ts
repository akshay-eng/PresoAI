/**
 * GET /api/user/api-usage/timeseries?days=30
 *
 * Daily request volume for the chart on /api-usage. Returns one row per day
 * over the window, even for days with zero traffic (so the chart doesn't
 * render gappy). Splits success vs error counts.
 *
 * Response: { points: [{ date: "2026-05-01", success: 0, error: 0 }, ...] }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;

    const url = new URL(request.url);
    const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") || "30", 10) || 30));
    const since = new Date(Date.now() - days * DAY_MS);

    // Group by day (UTC) and statusCode bucket. Done in raw SQL because Prisma
    // doesn't support GROUP BY on a derived date expression directly.
    type Row = { day: Date; bucket: "success" | "error"; count: bigint };
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        DATE_TRUNC('day', "createdAt") AS day,
        CASE WHEN "statusCode" >= 400 THEN 'error' ELSE 'success' END AS bucket,
        COUNT(*)::bigint AS count
      FROM api_request_log
      WHERE "userId" = ${userId}
        AND "createdAt" >= ${since}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    // Build a full day list so days with zero rows still appear.
    const bucketByDay = new Map<string, { success: number; error: number }>();
    for (const r of rows) {
      const key = r.day.toISOString().slice(0, 10);
      const cur = bucketByDay.get(key) || { success: 0, error: 0 };
      cur[r.bucket] = Number(r.count);
      bucketByDay.set(key, cur);
    }

    const points: Array<{ date: string; success: number; error: number }> = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      const v = bucketByDay.get(key) || { success: 0, error: 0 };
      points.push({ date: key, success: v.success, error: v.error });
    }

    return NextResponse.json({ points });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
