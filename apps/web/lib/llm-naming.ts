/**
 * Server-side helper for generating short, human-readable titles via the
 * python-agent's `/summarize-name` endpoint. Used to:
 *   - Replace the truncated 60-char project name with a real phrase as soon
 *     as the user submits their first prompt.
 *   - Replace presentation titles (which feed Content-Disposition + WOPI)
 *     with the cover-slide topic.
 *
 * The endpoint always returns a name (LLM result OR a fallback heuristic),
 * so this function never throws on the happy path. It uses a tight 8s
 * timeout so a stuck python-agent can't block project creation.
 */

const PYTHON_AGENT_URL =
  process.env.PYTHON_AGENT_URL ||
  process.env.PPTX_AGENT_URL?.replace(":8100", ":8000") ||
  "http://localhost:8000";

const TIMEOUT_MS = 8000;

export type SummarizeKind = "project" | "presentation";

export async function summarizeForName(
  text: string,
  kind: SummarizeKind = "project"
): Promise<string | null> {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PYTHON_AGENT_URL}/summarize-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed, kind }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string };
    const name = (data?.name || "").trim();
    return name || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
