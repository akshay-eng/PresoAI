import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const since30 = new Date(now.getTime() - 30 * dayMs);
  const since7 = new Date(now.getTime() - 7 * dayMs);
  const since1 = new Date(now.getTime() - dayMs);

  const [
    totalUsers,
    newUsers7d,
    newUsers30d,
    usersWithKeys,
    couponRedeemed,
    totalProjects,
    projects30d,
    totalPresentations,
    presentations30d,
    totalDownloads,
    downloads30d,
    totalJobs,
    jobsByStatus,
    tokenAgg,
    activeMau,
    activeWau,
    activeDau,
    bySource,
    sourceFilesTotal,
    slidesIndexedTotal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since7 } } }),
    prisma.user.count({ where: { createdAt: { gte: since30 } } }),
    prisma.providerApiKey.findMany({
      where: { isValid: true },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.user.count({ where: { couponCode: { not: null } } }),
    prisma.project.count(),
    prisma.project.count({ where: { createdAt: { gte: since30 } } }),
    prisma.presentation.count(),
    prisma.presentation.count({ where: { createdAt: { gte: since30 } } }),
    prisma.downloadEvent.count(),
    prisma.downloadEvent.count({ where: { createdAt: { gte: since30 } } }),
    prisma.job.count(),
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.usageRecord.aggregate({
      _sum: { totalTokens: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      _count: { _all: true },
    }),
    prisma.job
      .findMany({
        where: { createdAt: { gte: since30 } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((rows) => rows.length),
    prisma.job
      .findMany({
        where: { createdAt: { gte: since7 } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((rows) => rows.length),
    prisma.job
      .findMany({
        where: { createdAt: { gte: since1 } },
        select: { userId: true },
        distinct: ["userId"],
      })
      .then((rows) => rows.length),
    prisma.usageRecord.groupBy({
      by: ["source"],
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCostUsd: true },
    }),
    prisma.sourceFile.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM slide_index`,
  ]);

  const usersWithKeysCount = usersWithKeys.length;
  const freeUsers = Math.max(0, totalUsers - usersWithKeysCount - couponRedeemed);

  const tokenSum = tokenAgg._sum.totalTokens || 0;
  const inputSum = tokenAgg._sum.inputTokens || 0;
  const outputSum = tokenAgg._sum.outputTokens || 0;
  const costSum = tokenAgg._sum.estimatedCostUsd || 0;

  return NextResponse.json({
    users: {
      total: totalUsers,
      new7d: newUsers7d,
      new30d: newUsers30d,
      withOwnKeys: usersWithKeysCount,
      couponRedeemed,
      free: freeUsers,
      active: { dau: activeDau, wau: activeWau, mau: activeMau },
    },
    projects: { total: totalProjects, last30d: projects30d },
    presentations: { total: totalPresentations, last30d: presentations30d },
    downloads: { total: totalDownloads, last30d: downloads30d },
    jobs: {
      total: totalJobs,
      byStatus: Object.fromEntries(jobsByStatus.map((g) => [g.status, g._count._all])),
    },
    tokens: {
      total: tokenSum,
      input: inputSum,
      output: outputSum,
      generations: tokenAgg._count._all,
      estimatedCostUsd: Math.round(costSum * 10000) / 10000,
      bySource: bySource.map((s) => ({
        source: s.source,
        generations: s._count._all,
        tokens: s._sum.totalTokens || 0,
        cost: Math.round((s._sum.estimatedCostUsd || 0) * 10000) / 10000,
      })),
    },
    find: {
      sourceFiles: sourceFilesTotal,
      slidesIndexed: Number(slidesIndexedTotal[0]?.count ?? 0),
    },
    generatedAt: now.toISOString(),
  });
}
