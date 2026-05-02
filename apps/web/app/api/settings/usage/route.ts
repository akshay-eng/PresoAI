import { NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

/**
 * GET /api/settings/usage — returns user's usage stats + free tier status
 */
export async function GET() {
  try {
    const session = await getRequiredSession();
    const userId = session.user.id;

    // Coupon-redeemed users get unlimited free generations (handled in generate route too)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { couponCode: true, couponRedeemedAt: true },
    });

    // Get or create free tier session
    let freeTier = await prisma.freeTierSession.findUnique({ where: { userId } });

    if (!freeTier) {
      freeTier = await prisma.freeTierSession.create({
        data: { userId, generationsUsed: 0, maxGenerations: 1, windowHours: 8 },
      });
    }

    // Check if window has expired — reset if so
    const windowEnd = new Date(freeTier.windowStart.getTime() + freeTier.windowHours * 60 * 60 * 1000);
    const now = new Date();

    if (now > windowEnd) {
      freeTier = await prisma.freeTierSession.update({
        where: { userId },
        data: { generationsUsed: 0, windowStart: now },
      });
    }

    const freeRemaining = Math.max(0, freeTier.maxGenerations - freeTier.generationsUsed);
    const windowEndTime = new Date(freeTier.windowStart.getTime() + freeTier.windowHours * 60 * 60 * 1000);

    // Check if user has their own API keys
    const userKeys = await prisma.providerApiKey.findMany({
      where: { userId, isValid: true },
      select: { provider: true },
    });
    const hasOwnKeys = userKeys.length > 0;

    // Get usage records (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const usageRecords = await prisma.usageRecord.findMany({
      where: { userId, createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: "desc" },
    });

    // Aggregate by source
    const freeTierUsage = usageRecords.filter((r) => r.source === "free_tier");
    const userKeyUsage = usageRecords.filter((r) => r.source === "user_key");

    const totalTokens = usageRecords.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalCost = userKeyUsage.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const freeTierTokens = freeTierUsage.reduce((sum, r) => sum + r.totalTokens, 0);

    // Aggregate by provider
    const byProvider: Record<string, { tokens: number; cost: number; count: number }> = {};
    for (const r of userKeyUsage) {
      if (!byProvider[r.provider]) byProvider[r.provider] = { tokens: 0, cost: 0, count: 0 };
      byProvider[r.provider]!.tokens += r.totalTokens;
      byProvider[r.provider]!.cost += r.estimatedCostUsd;
      byProvider[r.provider]!.count += 1;
    }

    return NextResponse.json({
      freeTier: {
        used: freeTier.generationsUsed,
        max: freeTier.maxGenerations,
        remaining: freeRemaining,
        windowEnd: windowEndTime.toISOString(),
        windowHours: freeTier.windowHours,
      },
      coupon: {
        redeemed: !!user?.couponCode,
        code: user?.couponCode ?? null,
        redeemedAt: user?.couponRedeemedAt ?? null,
      },
      hasOwnKeys,
      configuredProviders: userKeys.map((k) => k.provider),
      usage: {
        totalTokens,
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        freeTierTokens,
        byProvider,
        recentRecords: usageRecords.slice(0, 20),
      },
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
