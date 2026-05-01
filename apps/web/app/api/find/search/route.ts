import { NextRequest, NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logger } from "@/lib/logger";

type RawHit = {
  id: string;
  rank: number;
  score: number;
  slide_number: number;
  thumbnail_s3_key: string;
  snippet: string;
  source_file_id: string;
  source_file_name: string;
  dominant_colors: Array<{ hex: string; weight: number }> | null;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const q = request.nextUrl.searchParams.get("q")?.trim() || "";
    const limitRaw = parseInt(request.nextUrl.searchParams.get("limit") || "24", 10);
    const limit = Math.min(Math.max(limitRaw, 1), 60);

    if (!q) return NextResponse.json({ results: [] });

    const pythonAgentUrl = process.env.PYTHON_AGENT_URL || "http://localhost:8000";
    const res = await fetch(`${pythonAgentUrl}/find/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: session.user.id, query: q, limit }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.error({ status: res.status, text: text.slice(0, 200) }, "Search proxy failed");
      return NextResponse.json({ error: "Search failed" }, { status: 502 });
    }

    const data = (await res.json()) as { results: RawHit[] };

    // Pre-sign thumbnail URLs server-side so the browser can render directly.
    const results = await Promise.all(
      (data.results || []).map(async (r) => {
        let thumbnailUrl: string | null = null;
        try {
          thumbnailUrl = await getPresignedDownloadUrl(r.thumbnail_s3_key, 3600);
        } catch {
          // ignore — render without thumbnail
        }
        return {
          id: r.id,
          rank: r.rank,
          score: r.score,
          slideNumber: r.slide_number,
          snippet: r.snippet,
          thumbnailUrl,
          sourceFileId: r.source_file_id,
          sourceFileName: r.source_file_name,
          dominantColors: r.dominant_colors,
        };
      })
    );

    return NextResponse.json({ results });
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    logger.error({ error: (err as Error).message }, "Find search failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
