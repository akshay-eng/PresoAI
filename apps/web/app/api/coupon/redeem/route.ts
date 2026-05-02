import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { isValidCoupon, normalizeCoupon } from "@/lib/coupons";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const code = typeof body.code === "string" ? normalizeCoupon(body.code) : "";

    if (!code) {
      return NextResponse.json({ error: "Coupon code is required" }, { status: 400 });
    }
    if (!isValidCoupon(code)) {
      return NextResponse.json({ error: "Invalid coupon code" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, couponCode: true, couponRedeemedAt: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.couponCode) {
      return NextResponse.json({
        ok: true,
        alreadyRedeemed: true,
        couponCode: user.couponCode,
        couponRedeemedAt: user.couponRedeemedAt,
      });
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { couponCode: code, couponRedeemedAt: new Date() },
      select: { couponCode: true, couponRedeemedAt: true },
    });

    logger.info({ userId: session.user.id, code }, "Coupon redeemed");

    return NextResponse.json({
      ok: true,
      alreadyRedeemed: false,
      couponCode: updated.couponCode,
      couponRedeemedAt: updated.couponRedeemedAt,
    });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Coupon redeem failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
