import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth";

const schema = z.object({
  text: z.string().min(1).max(4000),
  hasExistingDeck: z.boolean().optional(),
  audience: z.string().optional(),
  numSlides: z.number().int().optional(),
});

const PYTHON_AGENT_URL =
  process.env.PYTHON_AGENT_URL ||
  process.env.PPTX_AGENT_URL?.replace(":8100", ":8000") ||
  "http://localhost:8000";

/**
 * Thin proxy to the python-agent's /classify-intent endpoint. Authenticated
 * so anonymous traffic can't drive up Gemini quota; returns a generate
 * fallback if the agent is unreachable so we never block a real deck request.
 */
export async function POST(request: NextRequest) {
  try {
    await getRequiredSession();
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ action: "generate", reply: "" });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${PYTHON_AGENT_URL}/classify-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: parsed.data.text,
          has_existing_deck: parsed.data.hasExistingDeck ?? false,
          audience: parsed.data.audience,
          num_slides: parsed.data.numSlides,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return NextResponse.json({ action: "generate", reply: "" });
      const data = await res.json();
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({ action: "generate", reply: "" });
    }
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ action: "generate", reply: "" });
  }
}
