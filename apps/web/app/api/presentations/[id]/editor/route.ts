import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";

/**
 * GET /api/presentations/[id]/editor
 *
 * Returns the Collabora Online editor iframe URL.
 * Collabora uses WOPI protocol — it calls our /api/wopi/files/[id] endpoints.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;

    const presentation = await prisma.presentation.findFirst({
      where: { id },
      include: { project: { select: { userId: true } } },
    });

    if (!presentation || presentation.project.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!presentation.s3Key) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    // Use the nginx proxy URL — serves Collabora on port 80 (avoids WebSocket port mismatch)
    // Collabora served via nginx proxy on port 80 (Collabora's JS expects same-origin on default port)
    const collaboraUrl = process.env.COLLABORA_URL || "http://localhost";

    // Discover Collabora's capabilities
    let discoveryXml: string;
    try {
      const discoveryRes = await fetch(`${collaboraUrl}/hosting/discovery`);
      if (!discoveryRes.ok) throw new Error(`Discovery failed: ${discoveryRes.status}`);
      discoveryXml = await discoveryRes.text();
    } catch {
      return NextResponse.json(
        { error: "Collabora is not running. Start with: docker compose up -d collabora" },
        { status: 503 }
      );
    }

    // Extract the editor URL for .pptx from discovery XML
    const pptxMatch = discoveryXml.match(/ext="pptx"[^>]*urlsrc="([^"]+)"/);
    if (!pptxMatch) {
      return NextResponse.json({ error: "Collabora does not support PPTX" }, { status: 500 });
    }

    let editorUrlTemplate = pptxMatch[1]!;

    // Fix the URL: Collabora returns http://localhost/... but we need http://localhost:9980/...
    editorUrlTemplate = editorUrlTemplate.replace(
      /^http:\/\/localhost\//,
      `${collaboraUrl}/`
    );

    // Build WOPI source URL — Collabora runs in Docker so use host.docker.internal
    const wopiSrc = `http://host.docker.internal:3000/api/wopi/files/${id}`;

    // Build final iframe URL — remove template placeholders and add WOPISrc
    editorUrlTemplate = editorUrlTemplate.replace(/<[^>]+>/g, "");
    const separator = editorUrlTemplate.includes("?") ? "&" : "?";
    const iframeUrl = `${editorUrlTemplate}${separator}WOPISrc=${encodeURIComponent(wopiSrc)}&lang=en`;

    return NextResponse.json({ iframeUrl, collaboraUrl, type: "collabora" });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
