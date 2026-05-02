import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("days") || "30", 10), 7),
    180
  );
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const dayList: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    dayList.push(d.toISOString().slice(0, 10));
  }

  const [
    daily,
    uniqueDaily,
    countries,
    pages,
    devices,
    browsers,
    referrers,
    totalsLast30,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; count: number }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY day ORDER BY day
    `,
    prisma.$queryRaw<Array<{ day: string; count: number }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COUNT(DISTINCT COALESCE("userId", "uaSummary"))::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY day ORDER BY day
    `,
    prisma.$queryRaw<Array<{ country: string; count: number }>>`
      SELECT COALESCE("country", 'Unknown') AS country, COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY country
      ORDER BY count DESC
      LIMIT 25
    `,
    prisma.$queryRaw<Array<{ path: string; count: number }>>`
      SELECT path, COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY path
      ORDER BY count DESC
      LIMIT 20
    `,
    prisma.$queryRaw<Array<{ device: string; count: number }>>`
      SELECT COALESCE("device", 'unknown') AS device, COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY device
      ORDER BY count DESC
    `,
    prisma.$queryRaw<Array<{ ua: string; count: number }>>`
      SELECT COALESCE("uaSummary", 'Unknown') AS ua, COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY ua
      ORDER BY count DESC
      LIMIT 12
    `,
    prisma.$queryRaw<Array<{ referrer: string; count: number }>>`
      SELECT COALESCE(NULLIF(regexp_replace("referrer", '^https?://([^/]+).*$', '\\1'), ''), 'direct') AS referrer,
             COUNT(*)::int AS count
      FROM page_views
      WHERE "createdAt" >= ${start}
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 12
    `,
    prisma.pageView.count({ where: { createdAt: { gte: start } } }),
  ]);

  const dailyMap = new Map(daily.map((r) => [r.day, r.count]));
  const uniqueMap = new Map(uniqueDaily.map((r) => [r.day, r.count]));
  const series = dayList.map((d) => ({
    day: d,
    views: dailyMap.get(d) ?? 0,
    visitors: uniqueMap.get(d) ?? 0,
  }));

  return NextResponse.json({
    days: dayList,
    series,
    totalViews: totalsLast30,
    totalUniqueVisitors: uniqueDaily.reduce((s, r) => s + r.count, 0),
    countries,
    pages,
    devices,
    browsers,
    referrers,
  });
}
