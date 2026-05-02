import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { auth } from "@/lib/auth";
import { detectDevice, summarizeUa } from "@/lib/track-helpers";

const PATH_MAX = 200;
const REF_MAX = 500;

export async function POST(request: NextRequest) {
  try {
    let path = "";
    let referrer: string | null = null;
    try {
      const body = (await request.json()) as { path?: string; referrer?: string };
      path = (body.path || "").slice(0, PATH_MAX);
      referrer = body.referrer ? body.referrer.slice(0, REF_MAX) : null;
    } catch {
      return NextResponse.json({ ok: true });
    }
    if (!path) return NextResponse.json({ ok: true });

    // Cloudflare-provided geo header (Cloudflare Tunnel passes it through).
    const country = request.headers.get("cf-ipcountry");
    const ua = request.headers.get("user-agent");
    const device = detectDevice(ua);

    // Drop bot traffic — never useful for product analytics.
    if (device === "bot") return NextResponse.json({ ok: true });

    // Resolve user id if there's a session, but never block on it.
    let userId: string | null = null;
    try {
      const session = await auth();
      const id = (session?.user as { id?: string } | undefined)?.id;
      if (id) userId = id;
    } catch { /* unauth — fine */ }

    await prisma.pageView.create({
      data: {
        userId,
        path,
        referrer,
        country: country && country !== "XX" ? country : null,
        device,
        uaSummary: summarizeUa(ua),
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never let analytics block UX. Always return 200-ish.
    return NextResponse.json({ ok: true });
  }
}
