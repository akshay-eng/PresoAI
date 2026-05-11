/**
 * GET /v1/decks/[id]
 *
 * Read deck metadata. Returns project info + a list of all rendered
 * presentation versions with their thumbnail URLs and slide counts.
 *
 * Response (200):
 *   { deckId, name, prompt, audienceType, numSlides, createdAt,
 *     styleProfileId?, presentations: [{ id, version, slideCount, title, createdAt }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { withApiAuth, jsonError } from "@/lib/v1-auth";

interface Ctx { params: Promise<{ id: string }> }

export const GET = (request: NextRequest, ctx: Ctx) =>
  withApiAuth({ endpoint: "GET /v1/decks/[id]" }, async (req, auth) => {
    const { id } = await ctx.params;

    const project = await prisma.project.findFirst({
      where: { id, userId: auth.user.id },
      include: {
        presentations: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            slideCount: true,
            title: true,
            createdAt: true,
          },
        },
      },
    });
    if (!project) return jsonError(404, "deck_not_found", "Deck not found");

    return NextResponse.json({
      deckId: project.id,
      name: project.name,
      prompt: project.prompt,
      audienceType: project.audienceType,
      numSlides: project.numSlides,
      styleProfileId: project.styleProfileId,
      createdAt: project.createdAt.toISOString(),
      presentations: project.presentations.map((p) => ({
        id: p.id,
        version: p.version,
        slideCount: p.slideCount,
        title: p.title,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  })(request);
