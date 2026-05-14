"""Surgical edit agent — modifies an existing deck without rebuilding it.

The Claude Code mental model: keep the source code as the source of truth.
When the user asks for a change, identify which slides need to change, edit
ONLY those slides' pptxgenjs code, and leave the rest alone.

Compared to the full langgraph (research → outline → research synthesis →
slide_writer), this is single-pass and ~10x faster:

  load existing slides → LLM patches the affected ones → re-render

Inputs (job data):
  existingSlides     — list[{slide_number, title, code, speaker_notes}]
  instruction        — natural-language edit instruction
  targetSlides       — optional list[int]; None lets the agent decide
  themeSnapshot      — original themeConfig used to render the deck
  styleGuide         — original style profile prose (if any)
  visualStyle        — original style profile visual attributes (if any)

Outputs (returned dict):
  slides             — full patched slide array (length unchanged)
  editedSlideNumbers — list of slide_numbers that were modified
"""

from __future__ import annotations

import json
import re
from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.models.schemas import LLMConfig
from app.services.llm_factory import get_model

logger = structlog.get_logger()


def _get_llm(model_cfg: dict, temperature: float = 0.4, max_tokens: int = 16000) -> Any:
    config = LLMConfig(
        provider=model_cfg.get("provider", "openai"),
        model=model_cfg.get("model", "gpt-4o"),
        base_url=model_cfg.get("base_url"),
        api_key=model_cfg.get("api_key"),
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return get_model(config)


def _format_palette(theme_config: dict) -> str:
    """Render the locked palette as plain text the LLM can quote in code."""
    if not theme_config:
        return "(no brand palette locked)"
    nested = theme_config.get("colors") if isinstance(theme_config.get("colors"), dict) else None
    if nested:
        rows = []
        for k in ("primary", "secondary", "accent1", "accent2", "accent3", "accent4",
                 "background", "surface", "text_primary", "text_muted", "text_inverse"):
            v = nested.get(k)
            if isinstance(v, str) and v:
                rows.append(f"  {k:<14} {v.lstrip('#').upper()}")
        return "\n".join(rows) if rows else "(palette empty)"
    # Legacy flat OOXML format
    rows = []
    for k in ("accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
              "dk1", "lt1", "dk2", "lt2"):
        v = theme_config.get(k) if isinstance(theme_config.get(k), str) else None
        if v:
            rows.append(f"  {k:<14} {v.lstrip('#').upper()}")
    return "\n".join(rows) if rows else "(palette empty)"


SYSTEM_PROMPT = """You are an EDIT agent for an existing pptxgenjs presentation.

You receive the current source code of every slide in the deck and a single
natural-language instruction from the user. Your job is the same as Claude
Code's `Edit` tool, applied to slide source:

  1. Identify the SMALLEST set of slides that need to change to satisfy the
     instruction. If the instruction says "change the cover title", only
     slide 1 changes — do not touch any other slide.
  2. For each affected slide, output the full new pptxgenjs JS for that slide.
     Preserve every element the instruction did NOT mention. Same coordinates,
     same colors (from the LOCKED PALETTE below), same typography, same
     structure. Just patch the parts the user asked about.
  3. NEVER restyle the deck. NEVER swap the palette. NEVER re-derive colors.
     The locked palette is binding — every hex value must come from it.
  4. ADD a new slide when the instruction asks to add one (e.g. "add a closing
     slide", "append a thank-you slide", "insert a slide about X"). To add a
     slide, include it in the slides[] array with `slide_number` equal to
     (existing deck length + 1) for an append, or the position where it
     should be inserted (existing slides at or after that number shift down).
     Use the same locked palette and visual language as the rest of the deck.
     REMOVE a slide when the instruction explicitly asks to remove one by
     setting `"remove": true` on its entry. Default to NOT changing the deck
     length unless the instruction is explicit.
  5. NEVER reformat working code "for cleanliness." Tiny diffs only.

Available globals inside slide code:
  • `slide`, `pres`, `Math`, `Buffer`, `console`
  • `embedSvg(svgString, { x, y, w, h, rotate?, transparency? })` — for
    gradient / rotated / glass-effect visuals via inline SVG.

# Hard rules — violations crash the renderer
  • `color` is ALWAYS a 6-char hex string. No '#'. No objects, no numbers.
  • `transparency` lives ONLY inside `fill: { color: 'XXX', transparency: N }`
    on a SHAPE. Never on `addText` root. Never on `addShape` root.
  • Backgrounds use ONLY `slide.background = { color: 'HEX' }` or
    `{ path: '...' }`. Never `{ fill: { ... } }` — pptxgenjs has a bug
    that crashes with that form.
  • Fresh `{}` literal per addText / addShape / addTable / addChart / addImage.
  • Every element fits inside [0, 13.33] x [0, 7.5].

# Output format — return ONLY this JSON object, nothing else
{
  "edited_slide_numbers": [<slide numbers you changed>],
  "summary": "<one short sentence describing what you changed>",
  "slides": [
    { "slide_number": N, "title": "...", "speaker_notes": "...", "code": "..." },
    ...
  ]
}

The "slides" array contains ONLY the slides you edited (the ones in
edited_slide_numbers). The orchestrator will splice them back into the full
deck, leaving the others untouched.

If the instruction is impossible or unclear, return:
  {"edited_slide_numbers": [], "summary": "<why>", "slides": []}
"""


async def run_edit_agent(
    *,
    existing_slides: list[dict],
    instruction: str,
    target_slides: list[int] | None,
    theme_config: dict,
    style_guide: str,
    visual_style: dict,
    selected_model: dict,
    project_context: str = "",
) -> dict:
    """Run the edit agent and return the full patched slides array."""

    if not existing_slides:
        raise ValueError("edit agent received empty existing_slides")

    llm = _get_llm(selected_model, temperature=0.3, max_tokens=20000)

    # Build the existing-slides view. We send the FULL code for every slide
    # so the model can reason about cross-slide consistency, but we make the
    # target slide explicit when the caller knows it.
    palette_block = _format_palette(theme_config)

    target_block = ""
    if target_slides:
        target_block = (
            f"\n## Target slides specified by the user: {target_slides}\n"
            "Only edit these unless your reading of the instruction strictly "
            "requires touching others.\n"
        )

    style_block = ""
    if style_guide:
        style_block += f"\n## Locked Style Guide (binding)\n{style_guide[:2500]}\n"
    if visual_style and isinstance(visual_style, dict):
        rows = []
        for k in ("design_language", "typography_treatment", "spacing",
                  "decoratives", "color_discipline", "info_density"):
            v = visual_style.get(k)
            if isinstance(v, str) and v:
                rows.append(f"  • {k.replace('_', ' ').title()}: {v}")
        if rows:
            style_block += "\n## Visual Style Attributes (binding)\n" + "\n".join(rows) + "\n"

    slides_dump = json.dumps(existing_slides, indent=2)

    # Per-project memory — prior outlines, decisions, entities, narrative.
    # Critical for edits: the agent often needs to remember what the user
    # discussed in earlier turns (e.g. "change the third bullet to what we
    # talked about yesterday") which lives only in memory.
    memory_block = ""
    if project_context:
        memory_block = (
            f"\n## Project Memory (consult this before patching)\n{project_context[:2500]}\n"
            "Use this to interpret references like 'the chart we discussed' or "
            "'apply yesterday's decision' — past turns may not appear elsewhere "
            "in this prompt.\n"
        )

    user_msg = (
        f"## Locked Brand Palette (every hex MUST come from here)\n{palette_block}\n"
        f"{style_block}\n"
        f"{memory_block}"
        f"## User's edit instruction\n{instruction}\n"
        f"{target_block}\n"
        f"## Current slide source (the source of truth)\n```json\n{slides_dump}\n```\n\n"
        "Make the smallest possible change. Output ONLY the JSON object described in the system prompt."
    )

    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=user_msg),
    ]

    logger.info(
        "edit_agent_invoking_llm",
        slide_count=len(existing_slides),
        target_slides=target_slides,
        instruction_preview=instruction[:120],
    )

    result = await llm.ainvoke(messages)
    raw = result.content if hasattr(result, "content") else str(result)

    parsed = _parse_edit_response(raw)
    if parsed is None:
        raise Exception(f"edit agent: failed to parse LLM response (length={len(raw)})")

    edited_numbers: list[int] = parsed.get("edited_slide_numbers", []) or []
    edited_slides: list[dict] = parsed.get("slides", []) or []
    summary: str = parsed.get("summary", "")

    if not edited_numbers and not edited_slides:
        # Edit agent declined to change anything; surface that to the caller.
        logger.warning("edit_agent_no_changes", summary=summary)
        return {
            "slides": existing_slides,
            "editedSlideNumbers": [],
            "summary": summary or "no changes were made",
        }

    # Index incoming patches by slide_number, and separately track removals.
    patches: dict[int, dict] = {}
    removals: set[int] = set()
    for s in edited_slides:
        if not isinstance(s, dict):
            continue
        sn = s.get("slide_number")
        if not isinstance(sn, int):
            continue
        if s.get("remove") is True:
            removals.add(sn)
            continue
        # Sanity: every patched slide must have non-empty code.
        if not isinstance(s.get("code"), str) or not s["code"].strip():
            logger.warning("edit_agent_dropped_empty_patch", slide_number=sn)
            continue
        patches[sn] = {
            "slide_number": sn,
            "title": s.get("title", "") or "",
            "speaker_notes": s.get("speaker_notes", "") or "",
            "code": s["code"],
        }

    existing_max = max(
        (o.get("slide_number") for o in existing_slides if isinstance(o.get("slide_number"), int)),
        default=0,
    )

    # Splice — handle three cases:
    #   1. UPDATE  — patch slide_number ≤ existing_max → swap in place
    #   2. REMOVE  — slide_number in removals → drop from output
    #   3. INSERT  — patch slide_number == existing_max + N → append in order
    final_slides: list[dict] = []
    actually_edited: list[int] = []
    for original in existing_slides:
        sn = original.get("slide_number")
        if isinstance(sn, int) and sn in removals:
            actually_edited.append(sn)
            continue  # drop
        if isinstance(sn, int) and sn in patches:
            final_slides.append(patches[sn])
            actually_edited.append(sn)
        else:
            final_slides.append(original)

    # Any patches whose slide_number is beyond the existing deck are new
    # slides — append them in slide_number order.
    new_slide_numbers = sorted(sn for sn in patches.keys() if sn > existing_max)
    for sn in new_slide_numbers:
        final_slides.append(patches[sn])
        actually_edited.append(sn)

    # Renumber sequentially so the renderer always sees 1..N (in case the LLM
    # used non-sequential numbers like 6 when the existing deck is 5).
    for i, slide in enumerate(final_slides, start=1):
        slide["slide_number"] = i

    logger.info(
        "edit_agent_completed",
        edited=actually_edited,
        added=new_slide_numbers,
        removed=sorted(removals),
        summary=summary[:200] if summary else None,
    )

    return {
        "slides": final_slides,
        "editedSlideNumbers": actually_edited,
        "summary": summary,
    }


def _parse_edit_response(raw: str) -> dict | None:
    """Pull the JSON object out of the LLM's response, tolerantly."""
    cleaned = raw.strip()
    # Strip a markdown code fence if present.
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", cleaned)
    if fence:
        cleaned = fence.group(1)
    # Find the outermost {...}.
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = cleaned[start : end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    # Last-ditch: try to repair common issues with embedded newlines in code.
    # We do this by re-escaping the value of every "code" key.
    try:
        # Best-effort balanced-brace traversal.
        result = json.loads(_repair_json_codes(candidate))
        if isinstance(result, dict):
            return result
    except Exception:
        return None
    return None


def _repair_json_codes(s: str) -> str:
    """Re-escape the contents of every "code": "..." string. Best-effort."""
    pattern = re.compile(r'"code"\s*:\s*"((?:[^"\\]|\\.)*)"', re.DOTALL)
    def fix(m: re.Match) -> str:
        inner = m.group(1)
        # Re-escape any literal newlines/CR/tabs that broke the JSON.
        inner = inner.replace("\\", "\\\\").replace('"', '\\"')
        inner = inner.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        return f'"code": "{inner}"'
    return pattern.sub(fix, s)
