/**
 * Support tickets API.
 *
 *   POST /api/support  — file a new ticket (signed-in user)
 *   GET  /api/support  — list the signed-in user's own tickets
 *
 * Admin endpoints live at /api/admin/support (separate file).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const CATEGORIES = ["bug", "feature_request", "ui_issue", "performance", "billing", "account", "other"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const AREAS = ["generation", "editing", "preview", "dashboard", "api", "account", "other"] as const;

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  area: z.enum(AREAS),
  description: z.string().min(10).max(4000),
  projectId: z.string().optional(),
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
});

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

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: session.user.id,
        ...parsed.data,
      },
      select: { id: true, createdAt: true },
    });

    logger.info(
      { ticketId: ticket.id, userId: session.user.id, category: parsed.data.category, severity: parsed.data.severity },
      "Support ticket filed"
    );

    return NextResponse.json(ticket, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Failed to file support ticket");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getRequiredSession();

    const items = await prisma.supportTicket.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ items });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
