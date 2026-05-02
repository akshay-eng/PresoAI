import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("limit") || "100", 10), 1),
    500
  );
  const sortBy = request.nextUrl.searchParams.get("sortBy") || "tokens";

  // Aggregate per-user metrics in one round-trip via raw SQL — much faster than N+1.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      createdAt: Date;
      couponCode: string | null;
      providerCount: number;
      projectCount: number;
      presentationCount: number;
      downloadCount: number;
      jobCount: number;
      totalTokens: number;
      estimatedCostUsd: number;
      lastActive: Date | null;
      models: string[];
    }>
  >`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role::text AS "role",
      u."createdAt",
      u."couponCode",
      (SELECT COUNT(*)::int FROM provider_api_keys k WHERE k."userId" = u.id AND k."isValid") AS "providerCount",
      (SELECT COUNT(*)::int FROM projects p WHERE p."userId" = u.id) AS "projectCount",
      (SELECT COUNT(*)::int FROM presentations pr
        JOIN projects p ON p.id = pr."projectId"
        WHERE p."userId" = u.id) AS "presentationCount",
      (SELECT COUNT(*)::int FROM download_events d WHERE d."userId" = u.id) AS "downloadCount",
      (SELECT COUNT(*)::int FROM jobs j WHERE j."userId" = u.id) AS "jobCount",
      COALESCE((SELECT SUM("totalTokens")::int FROM usage_records ur WHERE ur."userId" = u.id), 0) AS "totalTokens",
      COALESCE((SELECT SUM("estimatedCostUsd")::float FROM usage_records ur WHERE ur."userId" = u.id), 0) AS "estimatedCostUsd",
      (SELECT MAX(j."createdAt") FROM jobs j WHERE j."userId" = u.id) AS "lastActive",
      COALESCE(
        (SELECT array_agg(DISTINCT ur.model) FROM usage_records ur WHERE ur."userId" = u.id),
        ARRAY[]::text[]
      ) AS models
    FROM users u
    ORDER BY u."createdAt" DESC
  `;

  const items = rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    createdAt: r.createdAt,
    plan: r.couponCode
      ? `coupon:${r.couponCode}`
      : r.providerCount > 0
        ? "own_keys"
        : "free",
    providerCount: r.providerCount,
    projects: r.projectCount,
    presentations: r.presentationCount,
    downloads: r.downloadCount,
    jobs: r.jobCount,
    tokens: r.totalTokens,
    cost: Math.round(r.estimatedCostUsd * 10000) / 10000,
    lastActive: r.lastActive,
    models: r.models || [],
  }));

  const sorted = [...items].sort((a, b) => {
    switch (sortBy) {
      case "projects": return b.projects - a.projects;
      case "presentations": return b.presentations - a.presentations;
      case "downloads": return b.downloads - a.downloads;
      case "lastActive":
        return (b.lastActive ? +new Date(b.lastActive) : 0) - (a.lastActive ? +new Date(a.lastActive) : 0);
      case "createdAt": return +new Date(b.createdAt) - +new Date(a.createdAt);
      case "tokens":
      default:
        return b.tokens - a.tokens;
    }
  });

  return NextResponse.json({
    items: sorted.slice(0, limit),
    total: items.length,
    sortBy,
  });
}
