"""Preso Pro orchestrator — runs StyleResolver → Composer → Validator → Executor.

Called from worker.py when engine == "preso-pro". Consumes the same graph state
the existing engines do, so theme_config, outline, audience, etc. flow in
naturally. Outputs a completed PPTX to S3 and returns the key + slide count.
"""

from __future__ import annotations

import io
import os
import tempfile
import time
from typing import Any

import structlog

from app.models import LLMConfig
from app.services.llm_factory import get_model
from app.services.progress import ProgressPublisher
from app.services.s3 import S3Service

from app.preso_pro.executor import execute_slide, new_presentation
from app.preso_pro.planning import compose_slide
from app.preso_pro.planning.slide_spec import DeckContext, ShapeCall, SlideSpec
from app.preso_pro.style import resolve_deck_context
from app.preso_pro.validator import ValidationError, validate_slide_spec

logger = structlog.get_logger()


def _llm_from_state(state: dict, *, temperature: float = 0.6) -> Any:
    model_cfg = state.get("selected_model", {}) or {}
    # Composer outputs a verbose JSON spec with embedded examples — give it
    # generous headroom (the user's per-model max_tokens default may cap mid-spec).
    config = LLMConfig(
        provider=model_cfg.get("provider", "openai"),
        model=model_cfg.get("model", "gpt-4o"),
        base_url=model_cfg.get("base_url"),
        api_key=model_cfg.get("api_key"),
        temperature=temperature,
        max_tokens=max(8192, model_cfg.get("max_tokens", 4096)),
    )
    return get_model(config)


def _intent_from_outline_item(item: dict, slide_index: int, total: int) -> str:
    """Derive an intent tag from an outline item.

    Position is only a weak hint — content drives the choice. A "first slide"
    that's actually a problem-statement should not be forced into the hero
    playbook just because it's slide 1.
    """
    layout = (item.get("layout") or "").lower()
    title = (item.get("title") or "").lower()
    notes = (item.get("notes") or "").lower()
    points = item.get("key_points") or []
    pile = f"{layout} {title} {notes} " + " ".join(str(p).lower() for p in points)

    # Hero is now CONTENT-driven: only when the outline planner explicitly
    # marks it as a title/cover slide, OR the title is short and there's no
    # supporting content (a true cover slide).
    is_short_cover = (
        slide_index == 1
        and len(title) <= 50
        and not points
        and len(notes) < 40
    )
    if layout in ("title", "cover", "hero") or is_short_cover:
        return "hero"

    if slide_index == total and any(
        k in pile for k in ("thank", "questions", "q&a", "contact", "next step")
    ):
        return "closing"

    # ── Composite-friendly intents (new SmartArt-style shapes) ──
    if any(k in pile for k in ("swot", " matrix", "2x2", "four quadrants",
                               "four boxes", "framework grid")):
        return "matrix"
    if any(k in pile for k in ("milestone", "roadmap", "since we started",
                               "history", "journey")) or (
        "timeline" in pile and slide_index != total
    ):
        return "timeline"
    if any(k in pile for k in ("pillar", "core principle", "guiding principle",
                               "around the", "hub-and-spoke", "mission area",
                               "cornerstone")):
        return "pillars"
    if any(k in pile for k in ("lifecycle", "feedback loop", "iterative",
                               "build-measure", "ooda", "plan-do-check",
                               "retention loop")) or (
        "cycle" in pile and "lifecycle" not in pile
    ):
        return "cycle"
    if any(k in pile for k in ("org chart", "team structure", "reporting line",
                               "hierarchy of teams")):
        return "org-chart"

    # ── Existing intents ──
    if "quote" in pile or "testimonial" in pile:
        return "quote"
    if any(k in pile for k in ("comparison", " vs ", "before/after", "old way")):
        return "comparison"
    if any(k in pile for k in ("how it works", "how we work", "process", "workflow",
                               "steps")):
        return "process"
    if any(k in pile for k in ("feature", "capabilit", "what we offer", "what you get",
                               "benefit", "product highlight")):
        return "features"
    if any(k in pile for k in ("growth", "trend", "over time", "month", "quarter", "year")):
        return "data-trend"
    if any(k in pile for k in ("breakdown", "share", "mix", "distribution", "split")):
        return "share-breakdown"
    if any(k in pile for k in ("stat", "metric", "kpi", "numbers", "results", "impact")):
        return "stats-row"
    if any(k in pile for k in ("tier", "pyramid", "levels", "hierarchy")):
        return "hierarchy"
    return "section-body"


def _content_cue_from_outline_item(item: dict) -> str:
    points = item.get("key_points") or []
    notes = item.get("notes") or ""
    if points:
        bullets = "\n".join(f"- {p}" for p in points[:6])
        return f"Key points:\n{bullets}\n\nNotes: {notes}"[:1200]
    return notes[:1200]


def _fallback_spec(slide_index: int, intent: str, title: str) -> SlideSpec:
    """Built when the LLM call fails. Plain solid bg + title text — never crash."""
    return SlideSpec(
        slide_index=slide_index,
        intent=intent,
        background=ShapeCall(fn="solid_bg", args={"role": "background"}),
        elements=[
            ShapeCall(
                fn="title_text",
                args={
                    "text": title or "Slide",
                    "anchor": "center-left",
                    "tier": "h1",
                    "role": "text_primary",
                    "weight": 700,
                },
            )
        ],
    )


async def generate_preso_pro_deck(
    state: dict,
    *,
    project_id: str,
    job_id: str,
    user_id: str,
    project_name: str = "Presentation",
) -> dict[str, Any]:
    """Generate a complete deck via the Preso Pro engine.

    Returns: { s3_key, slide_count, deck_context }
    """
    publisher = ProgressPublisher(job_id)
    await publisher.publish("preso_pro_start", 0.55, "Starting Preso Pro engine...")

    # Step 1 — Resolve the locked deck context.
    deck_ctx = resolve_deck_context(
        user_prompt=state.get("user_prompt", ""),
        audience=state.get("audience_type", "marketing"),
        theme_config=state.get("theme_config") or {},
        style_guide=state.get("style_guide"),
        visual_style=state.get("visual_style"),
    )
    await publisher.publish(
        "preso_pro_style_locked",
        0.60,
        f"Locked palette: {deck_ctx.composition.mood} ({deck_ctx.composition.background_mode})",
    )
    logger.info(
        "preso_pro_deck_context",
        mood=deck_ctx.composition.mood,
        bg_mode=deck_ctx.composition.background_mode,
        palette={k: v.hex for k, v in deck_ctx.palette.items()},
    )

    # Step 2 — Compose every slide.
    outline = state.get("outline") or []
    if not outline:
        # Fallback: 1-slide deck with the user's prompt as title
        outline = [
            {"title": (state.get("user_prompt") or "Presentation")[:80],
             "layout": "title", "key_points": [], "notes": ""}
        ]

    llm = _llm_from_state(state)
    total = len(outline)
    specs: list[SlideSpec] = []
    project_context = state.get("project_context", "") or ""

    for idx, item in enumerate(outline, start=1):
        intent = _intent_from_outline_item(item, idx, total)
        title = (item.get("title") or "Slide").strip()
        cue = _content_cue_from_outline_item(item)
        logger.info(
            "preso_pro_slide_intent",
            slide=idx, intent=intent, title=title[:80],
        )

        await publisher.publish(
            "preso_pro_compose",
            0.60 + (0.20 * idx / max(total, 1)),
            f"Composing slide {idx}/{total}: {title[:60]}",
        )

        try:
            spec = await compose_slide(
                llm,
                deck_ctx,
                slide_index=idx,
                intent=intent,
                title=title,
                content_cue=cue,
                project_context=project_context,
            )
            try:
                validate_slide_spec(spec, deck_ctx)
            except ValidationError as ve:
                logger.warn("preso_pro_spec_invalid", slide=idx, err=str(ve))
                spec = _fallback_spec(idx, intent, title)
        except Exception as e:
            logger.warn("preso_pro_compose_failed", slide=idx, err=str(e))
            spec = _fallback_spec(idx, intent, title)

        specs.append(spec)

    # Step 3 — Render to PPTX.
    await publisher.publish("preso_pro_render", 0.85, "Rendering native PPTX...")
    prs = new_presentation()
    for spec in specs:
        try:
            execute_slide(prs, deck_ctx, spec)
        except Exception as e:
            logger.error("preso_pro_render_slide_failed", slide=spec.slide_index, err=str(e))
            # Render a fallback slide so we never produce a partial deck
            execute_slide(prs, deck_ctx, _fallback_spec(spec.slide_index, spec.intent, "Slide"))

    # Step 4 — Upload to S3.
    s3 = S3Service()
    s3_key = f"generated/{user_id}/{project_id}/preso-pro/{job_id}.pptx"

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pptx") as tmp:
        tmp_path = tmp.name
    final_path = tmp_path  # may get reassigned after SmartArt injection
    sa_injected_path: str | None = None
    try:
        prs.save(tmp_path)

        # Real-SmartArt post-process: any smart_art_* shape kit calls have
        # queued PendingSmartArt records on the package. Drain & inject them
        # by patching the saved .pptx zip with diagram parts + relationships.
        pending = getattr(prs.part.package, "_pending_smart_art", None) or []
        if pending:
            from app.preso_pro.smart_art import inject_smart_arts

            sa_injected_path = tmp_path + ".sa.pptx"
            inject_smart_arts(tmp_path, pending, sa_injected_path)
            final_path = sa_injected_path
            logger.info(
                "preso_pro_smart_art_injected",
                count=len(pending),
                layouts=[sa.layout_key for sa in pending],
            )

        s3.upload_file(
            final_path,
            s3_key,
            content_type=(
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            ),
        )
    finally:
        for path in (tmp_path, sa_injected_path):
            if not path:
                continue
            try:
                os.unlink(path)
            except OSError:
                pass

    await publisher.publish("preso_pro_done", 0.95, f"Generated {len(specs)} slides")
    await publisher.close()

    return {
        "s3_key": s3_key,
        "slide_count": len(specs),
        "deck_context": deck_ctx.model_dump(),
    }
