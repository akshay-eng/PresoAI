/**
 * GET /api/admin/support
 *
 * Admin-only. Returns every support ticket with the reporter joined in. The
 * admin dashboard renders these as cards.
 *
 * Query params:
 *   ?status=open|in_progress|resolved|closed|all   (default: all)
 *   ?limit=N                                       (default: 50, max 200)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "all").toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);

  const where: Record<string, unknown> = {};
  if (status !== "all") where.status = status;

  const tickets = await prisma.supportTicket.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  const items = tickets.map((t) => ({
    id: t.id,
    category: t.category,
    severity: t.severity,
    area: t.area,
    description: t.description,
    projectId: t.projectId,
    url: t.url,
    userAgent: t.userAgent,
    status: t.status,
    adminNotes: t.adminNotes,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    user: {
      id: t.user.id,
      email: t.user.email,
      name: t.user.name,
    },
  }));

  // Counters per status for the admin dashboard header chips.
  const counts = await prisma.supportTicket.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const summary = counts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return NextResponse.json({ items, summary });
}
