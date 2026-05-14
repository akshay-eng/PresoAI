/**
 * PATCH /api/admin/support/[id]
 *
 * Admin updates: status + optional notes. Setting status="resolved" stamps
 * resolvedAt.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

const patchSchema = z.object({
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  adminNotes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
    data.resolvedAt = parsed.data.status === "resolved" ? new Date() : null;
  }
  if (parsed.data.adminNotes !== undefined) {
    data.adminNotes = parsed.data.adminNotes;
  }

  const ticket = await prisma.supportTicket.update({
    where: { id },
    data,
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return NextResponse.json({
    id: ticket.id,
    status: ticket.status,
    adminNotes: ticket.adminNotes,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  });
}
