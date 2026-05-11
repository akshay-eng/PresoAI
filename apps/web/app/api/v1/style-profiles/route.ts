/**
 * GET /v1/style-profiles
 *
 * List the brand style profiles available to this account: the user's own
 * profiles plus the platform's three global defaults (IBM / ICICI / Wipro).
 * Use the returned IDs in POST /v1/decks `styleProfileId`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { withApiAuth } from "@/lib/v1-auth";

export const GET = (request: NextRequest) =>
  withApiAuth({ endpoint: "GET /v1/style-profiles" }, async (_req, auth) => {
    const profiles = await prisma.styleProfile.findMany({
      where: {
        OR: [{ userId: auth.user.id }, { isGlobal: true }],
        status: "ready",
      },
      orderBy: [{ isGlobal: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        isGlobal: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ items: profiles });
  })(request);
