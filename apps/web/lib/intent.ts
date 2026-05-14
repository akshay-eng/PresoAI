/**
 * Client-side wrapper around the python-agent's /classify-intent endpoint.
 *
 * Used to gate the deck-generation pipeline so that "hi", "what can you do",
 * "write me a poem", etc. don't kick off a full langgraph run + progress bar.
 * Returns the action plus a friendly reply for non-deck inputs that the UI
 * surfaces inline (instead of creating a project / starting generation).
 */

export type IntentAction = "generate" | "edit" | "clarify" | "decline" | "greeting";

export interface IntentResult {
  action: IntentAction;
  reply: string;
}

/** Cheap client-side heuristic for the most obvious cases (zero round-trip). */
function clientHeuristic(text: string): IntentResult | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const wordCount = t.split(/\s+/).length;

  // Long, detailed prompts (>= 150 chars) are clearly deck requests — the
  // LLM classifier returns "generate" for these every time. Short-circuit
  // saves a 1-3s round-trip to the python-agent on every "Send" click.
  if (text.trim().length >= 150) {
    return { action: "generate", reply: "" };
  }

  // Explicit deck-request vocabulary — if the prompt contains any of these
  // it's a generate intent regardless of length. Catches things like
  // "make me a 5 slide pitch deck" (under 150 chars but unambiguous).
  const deckVocab = /\b(deck|presentation|slides?|pitch|pptx?|powerpoint|keynote)\b/i;
  if (deckVocab.test(text) && wordCount >= 4) {
    return { action: "generate", reply: "" };
  }
  const greetings = new Set([
    "hi", "hello", "hey", "yo", "hi.", "hello.", "hey there",
    "good morning", "good afternoon", "good evening",
    "thanks", "thank you", "thx", "ty",
    "ok", "okay", "cool", "great",
  ]);
  if (greetings.has(t)) {
    return {
      action: "greeting",
      reply:
        "Hi! I build professional slide decks. What topic do you want a deck on, and roughly who is the audience?",
    };
  }
  if (
    t === "help" ||
    t === "?" ||
    t === "/help" ||
    [
      "what can you do",
      "what do you do",
      "what is this",
      "who are you",
      "how does this work",
      "how do i use",
    ].some((p) => t.includes(p))
  ) {
    return {
      action: "greeting",
      reply:
        "I generate marketing-quality PowerPoint decks from a prompt — give me a topic, audience (executive, technical, general, marketing), and roughly how many slides. I don't help with code, general research, or anything outside slide decks.",
    };
  }
  // Single-word non-greetings — too vague to be a deck request.
  if (wordCount === 1 && /^[a-z]+$/.test(t) && !greetings.has(t)) {
    return {
      action: "clarify",
      reply: `Are you looking for a deck about "${text.trim()}"? If so, tell me the audience and roughly how many slides.`,
    };
  }
  return null;
}

/**
 * Classify a user message. Falls back to {action:"generate"} on error so the
 * router never blocks a real deck request when the LLM is offline.
 *
 * `audience` and `numSlides` are passed through to the python-agent so the
 * classifier doesn't ask for clarification on info the UI already has
 * configured (the UI's selector always provides a default audience).
 */
export async function classifyIntent(
  text: string,
  hasExistingDeck: boolean = false,
  context?: { audience?: string; numSlides?: number },
): Promise<IntentResult> {
  const heuristic = clientHeuristic(text);
  if (heuristic) return heuristic;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        hasExistingDeck,
        audience: context?.audience,
        numSlides: context?.numSlides,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { action: "generate", reply: "" };
    const data = (await res.json()) as IntentResult;
    if (!data?.action) return { action: "generate", reply: "" };
    return data;
  } catch {
    return { action: "generate", reply: "" };
  }
}
