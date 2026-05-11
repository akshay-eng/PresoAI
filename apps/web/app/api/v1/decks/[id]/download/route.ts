/**
 * GET /v1/decks/[id]/download
 *
 * Returns a short-lived presigned download URL for the deck's latest (or a
 * specific, ?version=N) presentation. Caller should follow the URL within 1h.
 *
 * Response (200):
 *   { presentationId, version, slideCount, downloadUrl, expiresIn }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { withApiAuth, jsonError } from "@/lib/v1-auth";

interface Ctx { params: Promise<{ id: string }> }

export const GET = (request: NextRequest, ctx: Ctx) =>
  withApiAuth({ endpoint: "GET /v1/decks/[id]/download" }, async (req, auth) => {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const versionParam = url.searchParams.get("version");
    const version = versionParam ? parseInt(versionParam, 10) : null;
    if (versionParam && (Number.isNaN(version!) || version! < 1)) {
      return jsonError(400, "validation_failed", "version must be a positive integer");
    }

    // Verify ownership through the project relation, then resolve presentation.
    const project = await prisma.project.findFirst({
      where: { id, userId: auth.user.id },
      select: { id: true },
    });
    if (!project) return jsonError(404, "deck_not_found", "Deck not found");

    const presentation = await prisma.presentation.findFirst({
      where: {
        projectId: id,
        ...(version ? { version } : {}),
      },
      orderBy: { version: "desc" },
    });
    if (!presentation) return jsonError(404, "presentation_not_found", "No rendered presentation for this deck yet");

    const expiresIn = 3600;
    const downloadUrl = await getPresignedDownloadUrl(presentation.s3Key, expiresIn);

    return NextResponse.json({
      presentationId: presentation.id,
      version: presentation.version,
      slideCount: presentation.slideCount,
      downloadUrl,
      expiresIn,
    });
  })(request);
