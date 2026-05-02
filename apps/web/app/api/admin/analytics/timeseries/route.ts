import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

type Bucket = { day: string };

function bucketRange(days: number): { start: Date; days: string[] } {
  const days_arr: string[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    days_arr.push(d.toISOString().slice(0, 10));
  }
  return { start, days: days_arr };
}

function fillSeries<T extends Bucket>(days: string[], rows: T[], key: keyof T, defaultVal = 0) {
  const map = new Map<string, T>();
  for (const r of rows) map.set(r.day, r);
  return days.map((d) => ({
    day: d,
    [key]: (map.get(d)?.[key] as number | undefined) ?? defaultVal,
  }));
}

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
  const { start, days: dayList } = bucketRange(days);

  // Daily buckets for each metric.
  const [signups, projects, presentations, downloads, tokens, dau, providerSplit, modelSplit] =
    await Promise.all([
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM users
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM projects
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM presentations
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS count
        FROM download_events
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: string; count: number; cost: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COALESCE(SUM("totalTokens"), 0)::int AS count,
               COALESCE(SUM("estimatedCostUsd"), 0)::float AS cost
        FROM usage_records
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.$queryRaw<Array<{ day: string; count: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT "userId")::int AS count
        FROM jobs
        WHERE "createdAt" >= ${start}
        GROUP BY day ORDER BY day
      `,
      prisma.usageRecord.groupBy({
        by: ["provider"],
        where: { createdAt: { gte: start } },
        _sum: { totalTokens: true, estimatedCostUsd: true },
        _count: { _all: true },
      }),
      prisma.usageRecord.groupBy({
        by: ["model"],
        where: { createdAt: { gte: start } },
        _sum: { totalTokens: true },
        _count: { _all: true },
      }),
    ]);

  return NextResponse.json({
    days: dayList,
    signups: fillSeries(dayList, signups, "count"),
    projects: fillSeries(dayList, projects, "count"),
    presentations: fillSeries(dayList, presentations, "count"),
    downloads: fillSeries(dayList, downloads, "count"),
    tokens: dayList.map((d) => {
      const r = tokens.find((t) => t.day === d);
      return { day: d, tokens: r?.count ?? 0, cost: r ? Math.round(r.cost * 10000) / 10000 : 0 };
    }),
    dailyActiveUsers: fillSeries(dayList, dau, "count"),
    providers: providerSplit.map((p) => ({
      provider: p.provider,
      generations: p._count._all,
      tokens: p._sum.totalTokens || 0,
      cost: Math.round((p._sum.estimatedCostUsd || 0) * 10000) / 10000,
    })),
    models: modelSplit
      .map((m) => ({
        model: m.model,
        generations: m._count._all,
        tokens: m._sum.totalTokens || 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 20),
  });
}
