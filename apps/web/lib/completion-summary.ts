/**
 * Compose a conversational summary the agent posts to chat when a deck
 * generation completes. Uses the outline titles to give the user a concrete
 * "here's what I built" instead of a generic confirmation line — closer to
 * how a deep-agent-style assistant reports back.
 *
 * Deterministic, no LLM call. The outline is already produced by the
 * content_planner step and persisted on the job; we render it client-side.
 */

const ENGINE_LABELS: Record<string, string> = {
  "preso-pro": "Preso Pro",
  "preso-plus": "Preso Plus",
  "claude-code": "Preso Code",
  "node-worker": "Preso Elite",
};

const AUDIENCE_LABELS: Record<string, string> = {
  executive: "executive",
  technical: "technical",
  general: "general",
  marketing: "marketing",
};

export interface OutlineEntry {
  title?: string;
  slide_title?: string;
}

export function buildCompletionSummary(opts: {
  outline: OutlineEntry[];
  slideCount: number;
  engine: string;
  audience: string;
  /** Optional: when set, frames the summary as an edit report instead of a fresh build. */
  asEdit?: { instruction: string; targetSlides?: number[] };
}): string {
  const { outline, slideCount, engine, audience, asEdit } = opts;
  const engineLabel = ENGINE_LABELS[engine] || "Preso";
  const audLabel = AUDIENCE_LABELS[audience] || audience;

  const titles = (outline || [])
    .map((o) => (o.title || o.slide_title || "").trim())
    .filter(Boolean);

  if (asEdit) {
    const target = asEdit.targetSlides?.length
      ? `slide${asEdit.targetSlides.length > 1 ? "s" : ""} ${asEdit.targetSlides.join(", ")}`
      : "the deck";
    return [
      `Done — applied your edit to ${target}.`,
      "",
      `> ${asEdit.instruction.trim().slice(0, 200)}${asEdit.instruction.length > 200 ? "…" : ""}`,
      "",
      "Preview the result below, or download the updated .pptx.",
    ].join("\n");
  }

  const header = `Done. Built a ${slideCount}-slide deck via **${engineLabel}** for a ${audLabel} audience.`;
  if (titles.length === 0) {
    return [
      header,
      "",
      "Preview the result below, or download the .pptx. Tell me what to change and I'll iterate on this same deck.",
    ].join("\n");
  }

  const bullets = titles.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join("\n");
  return [
    header,
    "",
    "**Slides:**",
    bullets,
    "",
    "Preview the result below, or download the .pptx. Tell me what to change and I'll iterate on this same deck.",
  ].join("\n");
}
