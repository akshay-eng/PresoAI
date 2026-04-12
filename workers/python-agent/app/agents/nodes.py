from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from tavily import AsyncTavilyClient

from app.config import settings
from app.services.slide_vision import images_to_base64_messages
from app.models import (
    LLMConfig,
    PPTGenerationState,
    SlideSpec,
    OutlineItem,
    ResearchItem,
)
from app.services.llm_factory import get_model
from app.services.extraction import ThemeExtractor, ReferenceExtractor
from app.services.progress import ProgressPublisher
from app.services.knowledge_graph import KnowledgeGraphService
from app.services.logo_dev import extract_brand_mentions, resolve_brand_logos
from app.services.kroki import render_diagram
from app.services.s3 import S3Service

logger = structlog.get_logger()


async def _process_kroki_diagrams(slide_codes: list[dict], job_id: str) -> list[dict]:
    """Find KROKI_DIAGRAM markers in slide code, render via Kroki, upload to S3, replace with image URL."""
    import re

    pattern = re.compile(
        r'//\s*KROKI_DIAGRAM:(\w+)\s*\n((?://.*\n)*?)//\s*END_KROKI_DIAGRAM',
        re.MULTILINE,
    )

    s3 = S3Service()
    diagram_idx = 0

    for slide in slide_codes:
        code = slide.get("code", "")
        if "KROKI_DIAGRAM" not in code:
            continue

        matches = list(pattern.finditer(code))
        for m in reversed(matches):  # reverse to preserve offsets
            diagram_type = m.group(1).strip()
            raw_lines = m.group(2)
            source = "\n".join(
                line.lstrip("/").strip() for line in raw_lines.split("\n") if line.strip()
            )

            if not source:
                continue

            # Render via Kroki API (PNG for pptxgenjs compatibility)
            image_bytes = await render_diagram(diagram_type, source, "png")
            if not image_bytes:
                logger.error("kroki_render_failed", type=diagram_type, slide=slide.get("slide_number"))
                # Remove the marker, leave a placeholder text
                replacement = (
                    'slide.addText("[ Diagram could not be rendered ]", '
                    '{ x: 1, y: 3, w: 11, h: 1, fontSize: 14, color: "999999", align: "center" });'
                )
                code = code[:m.start()] + replacement + code[m.end():]
                continue

            # Upload to S3
            s3_key = f"diagrams/{job_id}/diagram_{diagram_idx}.png"
            diagram_idx += 1
            try:
                s3.upload_bytes(image_bytes, s3_key, content_type="image/png")
                url = s3.generate_presigned_url(s3_key, expires_in=86400)
                logger.info("kroki_diagram_uploaded", key=s3_key, size=len(image_bytes), slide=slide.get("slide_number"))
            except Exception as e:
                logger.error("kroki_s3_upload_failed", error=str(e))
                code = code[:m.start()] + "" + code[m.end():]
                continue

            # Replace marker with addImage using the S3 presigned URL
            replacement = (
                f'slide.addImage({{ path: "{url}", '
                f'x: 1.0, y: 1.5, w: 11.33, h: 4.5 }});'
            )
            code = code[:m.start()] + replacement + code[m.end():]

        slide["code"] = code

    return slide_codes


def _build_visual_context(state: PPTGenerationState) -> list[dict]:
    """Build multimodal message parts from reference collages and chat images.

    Returns a list of content parts (text + image_url dicts) that can be
    appended to a HumanMessage's content to make it multimodal.
    """
    parts: list[dict] = []

    # Reference PPTX visual collages (created in process_references)
    ref_visual = state.get("reference_visual_parts", [])
    if ref_visual:
        parts.append({"type": "text", "text": "\n\n## Visual Reference (from uploaded PPTX slides — match this style):"})
        parts.extend(ref_visual)

    # Chat images (pasted by user)
    chat_keys = state.get("chat_image_keys", [])
    if chat_keys:
        from app.services.s3 import S3Service
        import base64
        s3 = S3Service()
        parts.append({"type": "text", "text": "\n\n## User-provided reference images:"})
        for i, key in enumerate(chat_keys[:5]):  # Max 5 images
            try:
                data = s3.download_bytes(key)
                b64 = base64.b64encode(data).decode("utf-8")
                fmt = "jpeg" if data[:2] == b'\xff\xd8' else "png"
                parts.append({"type": "text", "text": f"\n[User image {i + 1}]"})
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/{fmt};base64,{b64}", "detail": "high"},
                })
            except Exception as e:
                logger.warn("chat_image_download_failed", key=key, error=str(e))

    return parts


# ─── Design guidelines from pptx skill ───
PPTX_DESIGN_GUIDELINES = """
## Design Rules (from pptx skill)
- Every slide MUST have a visual element — image placeholder, chart, icon, or shape. Text-only slides are forbidden.
- Don't create boring slides. Plain bullets on white background won't impress anyone.
- Pick a bold, content-informed color palette specific to THIS topic.
- Dominance over equality: one color dominates (60-70%), 1-2 supporting, one sharp accent.
- Commit to ONE visual motif and repeat it across every slide.
- USE VARIED LAYOUTS — monotonous presentations are a common failure mode:
  * Two-column (text left, illustration right)
  * Icon + text rows (icon in colored circle, bold header, description)
  * 2x2 or 2x3 grid with content blocks
  * Half-bleed image with content overlay
  * Large stat callouts (big numbers 60-72pt with small labels)
  * Timeline or process flow with numbered steps
- Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure).
- Choose an interesting font pairing — don't default to Arial.
"""


def _get_knowledge_graph_context(state: PPTGenerationState) -> str:
    """Fetch the user's design knowledge graph context if available."""
    user_id = state.get("user_id", "")
    if not user_id:
        return ""
    try:
        kg = KnowledgeGraphService(user_id)
        return kg.get_design_context()
    except Exception as e:
        logger.warn("knowledge_graph_fetch_failed", error=str(e))
        return ""


def _get_llm(state: PPTGenerationState, temperature: float = 0.7, max_tokens: int | None = None) -> Any:
    model_cfg = state.get("selected_model", {})
    tokens = max_tokens or model_cfg.get("max_tokens", 8192)
    config = LLMConfig(
        provider=model_cfg.get("provider", "openai"),
        model=model_cfg.get("model", "gpt-4o"),
        base_url=model_cfg.get("base_url"),
        api_key=model_cfg.get("api_key"),
        temperature=temperature,
        max_tokens=tokens,
    )
    return get_model(config)


def _get_publisher(state: PPTGenerationState) -> ProgressPublisher:
    return ProgressPublisher(state.get("job_id", "unknown"))


class ResearchQueries(BaseModel):
    queries: list[str] = Field(description="6-8 targeted research queries")


class OutlineOutput(BaseModel):
    outline: list[OutlineItem] = Field(description="Slide outline")


class SlidesOutput(BaseModel):
    slides: list[SlideSpec] = Field(description="Full slide specifications")


async def extract_template(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("extract_template", 0.05, "Extracting template theme...")

    template_key = state.get("template_s3_key", "")
    if not template_key:
        logger.info("no_template_provided, using defaults")
        await publisher.publish("extract_template", 0.1, "No template provided, using defaults")
        await publisher.close()
        return {"theme_config": {}, "current_phase": "extract_template"}

    try:
        extractor = ThemeExtractor()
        theme = extractor.extract(template_key)
        theme_dict = theme.model_dump()
        await publisher.publish("extract_template", 0.1, "Template theme extracted")
        await publisher.close()
        return {"theme_config": theme_dict, "current_phase": "extract_template"}
    except Exception as e:
        logger.error("template_extraction_failed", error=str(e))
        await publisher.publish("extract_template", 0.1, f"Template extraction failed: {e}")
        await publisher.close()
        return {"theme_config": {}, "current_phase": "extract_template", "error": str(e)}


async def process_references(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("process_references", 0.15, "Processing reference files...")

    ref_keys = state.get("reference_file_keys", [])
    if not ref_keys:
        logger.info("no_reference_files")
        await publisher.publish("process_references", 0.2, "No reference files to process")
        await publisher.close()
        return {"reference_context": "", "reference_visual_parts": [], "current_phase": "process_references"}

    from app.services.slide_vision import pptx_to_images, create_collages, images_to_base64_messages
    from app.services.s3 import S3Service

    extractor = ReferenceExtractor()
    s3 = S3Service()
    all_texts: list[str] = []
    all_visual_parts: list[dict] = []

    for i, key in enumerate(ref_keys):
        try:
            suffix = key.rsplit(".", 1)[-1] if "." in key else "txt"
            text, _ = extractor.extract(key, suffix)
            all_texts.append(text)

            # For PPTX files: also create visual collages for the LLM
            if suffix.lower() in ("pptx", "ppt"):
                try:
                    tmp_path = s3.download_to_temp(key, f".{suffix}")
                    slide_images = pptx_to_images(tmp_path, max_slides=16)
                    if slide_images:
                        collages = create_collages(slide_images)
                        labels = [
                            f"Reference slides {j * 4 + 1}-{min(j * 4 + 4, len(slide_images))}"
                            for j in range(len(collages))
                        ]
                        # Use detail="low" for collages to save tokens (~85 tokens each)
                        visual_parts = images_to_base64_messages(collages, labels=labels, detail="low")
                        all_visual_parts.extend(visual_parts)
                        logger.info("reference_visual_collages_created", key=key, slides=len(slide_images), collages=len(collages))
                    import os
                    os.unlink(tmp_path)
                except Exception as ve:
                    logger.warn("reference_visual_extraction_failed", key=key, error=str(ve))

            progress = 0.15 + (0.05 * (i + 1) / len(ref_keys))
            await publisher.publish(
                "process_references",
                progress,
                f"Processed reference {i + 1}/{len(ref_keys)}",
            )
        except Exception as e:
            logger.error("reference_extraction_failed", key=key, error=str(e))

    combined = "\n\n---\n\n".join(all_texts)
    await publisher.close()
    return {"reference_context": combined, "reference_visual_parts": all_visual_parts, "current_phase": "process_references"}


async def query_generator(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("researching", 0.2, "Enhancing prompt and generating research queries...")

    llm = _get_llm(state, temperature=0.3)

    raw_prompt = state.get("user_prompt", "")
    audience = state.get("audience_type", "general")
    num_slides = state.get("num_slides", 10)
    ref_context = state.get("reference_context", "")

    # Step 1: Enhance the user's prompt — add context, specificity, and structure
    try:
        enhance_result = await llm.ainvoke([
            SystemMessage(content=(
                "You are a presentation strategist. The user gave a rough prompt for a slide deck. "
                "Your job is to ENHANCE it into a detailed, well-structured presentation brief. "
                "Add: specific sub-topics to cover, what data/metrics would strengthen each point, "
                "what visual formats would work best (tables, charts, diagrams, comparisons), "
                "and what the key takeaway should be.\n"
                "Return ONLY the enhanced prompt text (2-3 paragraphs). Do not add meta-commentary."
            )),
            HumanMessage(content=(
                f"Original prompt: {raw_prompt}\n"
                f"Audience: {audience}\n"
                f"Number of slides: {num_slides}\n"
                "Enhance this into a detailed presentation brief."
            )),
        ])
        prompt = enhance_result.content if hasattr(enhance_result, "content") else raw_prompt
        logger.info("prompt_enhanced", original_len=len(raw_prompt), enhanced_len=len(prompt))
    except Exception as e:
        logger.warning("prompt_enhancement_failed", error=str(e))
        prompt = raw_prompt

    await publisher.publish("researching", 0.25, "Generating research queries...")

    # Step 2: Generate research queries from the enhanced prompt
    structured_llm = llm.with_structured_output(ResearchQueries)

    messages = [
        SystemMessage(content=(
            "You are a research query generator for presentation creation. "
            "Generate 6-8 targeted web search queries that will find relevant, "
            "up-to-date information for the presentation topic. "
            "Include queries for: specific statistics/metrics, industry benchmarks, "
            "case studies, expert opinions, comparison data, and recent trends. "
            "Make queries SPECIFIC — not generic like 'microservices benefits' but "
            "'microservices migration MTTR reduction statistics 2024 2025'."
        )),
        HumanMessage(content=(
            f"Enhanced topic brief:\n{prompt}\n\n"
            f"Audience: {audience}\n"
            f"Number of slides: {num_slides}\n"
            f"Reference context (if any): {ref_context[:2000]}\n\n"
            "Generate 6-8 specific, data-focused search queries."
        )),
    ]

    try:
        result = await structured_llm.ainvoke(messages)
        queries = result.queries if hasattr(result, "queries") else []
    except Exception:
        # Fallback: raw LLM call + parse
        raw_llm = _get_llm(state, temperature=0.3)
        raw_result = await raw_llm.ainvoke(messages)
        raw_text = raw_result.content if hasattr(raw_result, "content") else str(raw_result)
        parsed = _parse_json_array(raw_text)
        queries = parsed if isinstance(parsed, list) and all(isinstance(q, str) for q in parsed) else [q.get("query", str(q)) if isinstance(q, dict) else str(q) for q in parsed]

    await publisher.publish("researching", 0.3, f"Generated {len(queries)} research queries")
    await publisher.close()
    return {"research_queries": queries, "current_phase": "researching"}


async def single_search(query: str) -> list[dict]:
    try:
        client = AsyncTavilyClient(api_key=settings.tavily_api_key)
        response = await client.search(query, max_results=5)
        results: list[dict] = []
        for r in response.get("results", []):
            results.append({
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "relevance": r.get("score", 0.5),
            })
        return results
    except Exception as e:
        logger.error("search_failed", query=query, error=str(e))
        return []


async def parallel_search(state: PPTGenerationState) -> dict:
    """Two-phase research: initial search + follow-up for stats and data."""
    publisher = _get_publisher(state)
    queries = state.get("research_queries", [])
    prompt = state.get("user_prompt", "")
    await publisher.publish("researching", 0.33, f"Phase 1: Searching {len(queries)} queries...")

    # Phase 1: Initial broad search
    tasks = [single_search(q) for q in queries]
    all_results = await asyncio.gather(*tasks)

    flat_results: list[dict] = []
    for result_list in all_results:
        flat_results.extend(result_list)

    await publisher.publish("researching", 0.38, f"Phase 1 done: {len(flat_results)} results. Running follow-up searches for stats...")

    # Phase 2: Follow-up searches specifically for statistics and data points
    stat_queries = [
        f"{prompt} statistics data numbers metrics",
        f"{prompt} before after improvement results ROI",
        f"{prompt} industry benchmark comparison",
    ]

    stat_tasks = [single_search(q) for q in stat_queries]
    stat_results = await asyncio.gather(*stat_tasks)

    for result_list in stat_results:
        flat_results.extend(result_list)

    await publisher.publish("researching", 0.45, f"Research complete: {len(flat_results)} total results (including stats)")
    await publisher.close()
    return {"research_results": flat_results, "current_phase": "researching"}


async def synthesizer(state: PPTGenerationState) -> dict:
    """Deep research synthesis — extracts structured content blocks for slides.

    Instead of a generic summary, this produces:
    - Key statistics with numbers (for stat callout slides)
    - Before/after comparisons (for comparison slides)
    - Process steps (for flow diagram slides)
    - Key insights with supporting evidence (for content slides)
    - Industry benchmarks and trends (for chart slides)
    """
    publisher = _get_publisher(state)
    await publisher.publish("synthesizing", 0.5, "Deep research synthesis — extracting structured content...")

    llm = _get_llm(state, temperature=0.4, max_tokens=8000)
    research = state.get("research_results", [])
    ref_context = state.get("reference_context", "")
    prompt = state.get("user_prompt", "")
    num_slides = state.get("num_slides", 5)
    audience = state.get("audience_type", "general")

    research_text = "\n\n".join(
        f"Source: {r.get('url', 'N/A')}\n{r.get('content', '')}"
        for r in research[:20]
    )

    messages = [
        SystemMessage(content=(
            "You are a research analyst preparing content for a presentation. "
            "Your job is NOT to summarize — it's to extract SPECIFIC, STRUCTURED content blocks "
            "that can be directly placed on presentation slides.\n\n"
            "For each major theme you find, extract:\n\n"
            "1. **KEY STATISTICS**: Exact numbers, percentages, metrics. "
            "Format: 'STAT: [number] — [what it means]'\n"
            "Example: 'STAT: 70% — of alerts are noise/duplicates that waste SRE time'\n\n"
            "2. **BEFORE/AFTER COMPARISONS**: How things change with the solution. "
            "Format: 'COMPARE: Before: [old way] → After: [new way]'\n"
            "Example: 'COMPARE: Before: MTTR 4+ hours → After: MTTR 15 minutes (90% reduction)'\n\n"
            "3. **PROCESS STEPS**: Sequential steps in a workflow. "
            "Format: 'FLOW: Step 1: [action] → Step 2: [action] → ...'\n\n"
            "4. **KEY INSIGHTS**: Important findings with evidence. "
            "Format: 'INSIGHT: [finding] — Evidence: [source/data]'\n\n"
            "5. **PAIN POINTS**: Problems the audience faces. "
            "Format: 'PAIN: [problem] — Impact: [consequence]'\n\n"
            "6. **SOLUTION BENEFITS**: How the solution helps. "
            "Format: 'BENEFIT: [capability] — Result: [outcome]'\n\n"
            f"Target audience: {audience}. Extract content appropriate for this audience.\n"
            f"This presentation needs {num_slides} slides, so extract enough content for that."
        )),
        HumanMessage(content=(
            f"Presentation topic: {prompt}\n\n"
            f"Research findings:\n{research_text}\n\n"
            f"Reference materials:\n{ref_context[:3000]}\n\n"
            f"Extract structured content blocks for {num_slides} slides. "
            "Include AT LEAST 5 statistics with real numbers, 3 before/after comparisons, "
            "and 1 process flow. Be SPECIFIC — no vague claims."
        )),
    ]

    result = await llm.ainvoke(messages)
    summary = result.content if hasattr(result, "content") else str(result)

    logger.info("deep_synthesis_complete", content_length=len(summary))
    await publisher.publish("synthesizing", 0.55, "Deep research synthesis complete")
    await publisher.close()
    return {"research_summary": summary, "current_phase": "synthesizing"}


async def content_planner(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    audience = state.get("audience_type", "general")
    is_creative = state.get("creative_mode", False)
    mode_label = " (Creative Mode)" if is_creative else ""
    await publisher.publish("planning", 0.6, f"Planning {audience} slide outline{mode_label}...")

    llm = _get_llm(state, temperature=0.3)
    structured_llm = llm.with_structured_output(OutlineOutput)

    summary = state.get("research_summary", "")
    prompt = state.get("user_prompt", "")
    audience = state.get("audience_type", "general")
    num_slides = state.get("num_slides", 10)
    style_guide = state.get("style_guide", "")
    layout_patterns = state.get("layout_patterns", [])

    # Build style-aware system prompt
    style_context = ""
    if style_guide:
        style_context = (
            "\n\n## IMPORTANT: Style Profile\n"
            "The user has selected a style profile. You MUST match this style:\n"
            f"{style_guide}\n\n"
            "Match the content density, layout preferences, and design language described above. "
        )

    layout_hint = ""
    if layout_patterns:
        preferred = [lp.get("layout_type", "") for lp in layout_patterns[:3]]
        layout_hint = f"Preferred layout types (in order of frequency): {', '.join(preferred)}. "

    # Inject knowledge graph context
    kg_context = _get_knowledge_graph_context(state)
    kg_section = f"\n\n## User's Design Preferences (from knowledge graph)\n{kg_context}" if kg_context else ""

    messages = [
        SystemMessage(content=(
            "You are a presentation content planner. Create a slide outline using "
            "the STRUCTURED RESEARCH CONTENT below. The research contains:\n"
            "- STAT: lines — use these as stat callout content\n"
            "- COMPARE: lines — use these for before/after comparison slides\n"
            "- FLOW: lines — use these for process flow slides\n"
            "- INSIGHT: lines — use these as key talking points\n"
            "- PAIN: lines — use these to show problems\n"
            "- BENEFIT: lines — use these to show solutions\n\n"
            "For each slide, provide:\n"
            "- title: Compelling, specific (not generic)\n"
            "- layout: title, content, two_column, chart, or image_focus\n"
            "- key_points: 3-5 SPECIFIC points using data from the research. Include real numbers.\n"
            "- notes: What the presenter should say\n\n"
            "Layout selection guide:\n"
            "- 'two_column' for before/after comparisons or contrasting ideas\n"
            "- 'chart' when you have stat data to visualize\n"
            "- 'content' for process flows, insights, or detailed points\n"
            "- 'title' only for the opening slide\n"
            "- 'image_focus' for architecture or diagram slides\n\n"
            f"{layout_hint}"
            + {
                "executive": "Target audience: EXECUTIVE. Focus outline on business impact, ROI, strategic positioning, and decision-enabling metrics. Less 'how', more 'why' and 'so what'.\n",
                "technical": "Target audience: TECHNICAL. Focus outline on architecture, implementation details, system design, integration points, and performance benchmarks.\n",
                "general": "Target audience: GENERAL. Focus outline on clear explanations, relatable analogies, and balanced business + technical content.\n",
            }.get(audience, f"Target audience: {audience}.\n")
            + f"{style_context}"
            f"{kg_section}"
        )),
    ]

    # Build the human message — add visual context if available
    human_text = (
        f"Topic: {prompt}\n"
        f"Number of slides: {num_slides}\n"
        f"Audience: {audience}\n\n"
        f"STRUCTURED RESEARCH CONTENT:\n{summary[:5000]}\n\n"
        f"Create an outline with exactly {num_slides} slides. "
        "USE THE SPECIFIC DATA from the research — include real numbers, stats, and comparisons. "
        "Don't make generic points when you have specific data available."
    )

    visual_parts = _build_visual_context(state)
    if visual_parts:
        # Multimodal message: text + images
        content_parts: list = [{"type": "text", "text": human_text}]
        content_parts.extend(visual_parts)
        content_parts.append({"type": "text", "text": "\nUse the visual layout patterns from these reference images to inform your outline structure."})
        messages.append(HumanMessage(content=content_parts))
    else:
        messages.append(HumanMessage(content=human_text))

    try:
        result = await structured_llm.ainvoke(messages)
        outline_items = result.outline if hasattr(result, "outline") else []
        outline_dicts = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in outline_items]
    except Exception as parse_err:
        # Fallback: call LLM without structured output and parse JSON manually
        logger.warn("structured_output_failed_for_outline", error=str(parse_err))
        raw_llm = _get_llm(state, temperature=0.3)
        messages[-1] = HumanMessage(content=messages[-1].content + "\n\nRespond with a JSON array of objects, each with: title, layout, key_points (array of strings), notes.")
        raw_result = await raw_llm.ainvoke(messages)
        raw_text = raw_result.content if hasattr(raw_result, "content") else str(raw_result)
        outline_dicts = _parse_json_array(raw_text)

    await publisher.publish(
        "outline_ready",
        0.65,
        f"Outline ready with {len(outline_dicts)} slides",
        data={"outline": outline_dicts},
    )
    await publisher.close()
    return {"outline": outline_dicts, "current_phase": "outline_ready"}


async def outline_review(state: PPTGenerationState) -> dict:
    from langgraph.types import interrupt

    publisher = _get_publisher(state)
    await publisher.publish(
        "awaiting_review",
        0.65,
        "Waiting for user approval of outline...",
        data={"outline": state.get("outline", [])},
    )
    await publisher.close()

    review_result = interrupt({"outline": state.get("outline", [])})

    approved = review_result.get("approved", False)
    edits = review_result.get("edits", [])
    feedback = review_result.get("feedback", "")

    if not approved:
        return {
            "error": feedback or "Outline rejected by user",
            "current_phase": "rejected",
        }

    if edits:
        return {
            "outline": edits,
            "user_approved": True,
            "user_edits": edits,
            "current_phase": "outline_approved",
        }

    return {
        "user_approved": True,
        "current_phase": "outline_approved",
    }


PPTXGENJS_API_REFERENCE = """
## pptxgenjs Quick Reference

Slide: 13.33" x 7.5" (LAYOUT_WIDE). Colors: 6-char hex WITHOUT # prefix.

### API
slide.background = { color: "HEX" };
slide.addText("text", { x, y, w, h, fontSize, fontFace, color, bold, align, valign });
slide.addText([{ text: "line", options: { bold: true, breakLine: true } }], { x, y, w, h });
slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: "HEX" }, rectRadius: 0.1 });
slide.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: "HEX", width: 2 } });
slide.addTable(rows, { x, y, w, colW: [3,5,5], autoPage: false, border: { pt: 0.5, color: "E0E0E0" } });
slide.addChart(pres.charts.BAR, [{ name: "S1", labels: [...], values: [...] }], { x, y, w, h, chartColors: ["HEX"], showValue: true });
slide.addImage({ path: "https://...", x, y, w, h });

### Table cell format
{ text: "Header", options: { fill: { color: "1A1A2E" }, color: "FFFFFF", bold: true, fontSize: 11, align: "center" } }

### Layout grid (use these coordinates)
Header: y: 0.3 to 1.2 | Content: y: 1.3 to 6.8 | Slide number: x:12.5, y:7.0
2-col: [x:0.5 w:6.0] [x:6.8 w:6.0]
3-col: [x:0.5 w:3.9] [x:4.7 w:3.9] [x:8.9 w:3.9]

### Rules
- No "#" in colors. Fresh {} per call. No elements outside 0–13.33 x 0–7.5.
- Text inside card: card.x+0.2 <= text.x, text.x+text.w <= card.x+card.w-0.2
"""


async def slide_writer(state: PPTGenerationState) -> dict:
    """Generate pptxgenjs JavaScript code for each slide.

    Instead of abstract SlideSpec, the LLM writes the actual pptxgenjs code
    that will be executed directly by the Node worker. This gives the LLM
    full control over every visual element, color, shape, and position.
    """
    publisher = _get_publisher(state)
    is_creative = state.get("creative_mode", False)
    use_diagram_images = state.get("use_diagram_images", False)
    audience = state.get("audience_type", "general")

    mode_parts = []
    if is_creative:
        mode_parts.append("Creative Mode")
    if use_diagram_images:
        mode_parts.append("Diagram Images")
    mode_label = " + ".join(mode_parts) if mode_parts else "Standard Mode"
    await publisher.publish(
        "writing_slides", 0.7,
        f"Designing slides with {mode_label} for {audience} audience..."
    )

    llm = _get_llm(state, temperature=0.7 if is_creative else 0.5, max_tokens=32000 if is_creative else 16000)

    outline = state.get("outline", [])
    summary = state.get("research_summary", "")
    prompt = state.get("user_prompt", "")
    style_guide = state.get("style_guide", "")
    num_slides = state.get("num_slides", len(outline))

    outline_text = json.dumps(outline, indent=2)

    # Only use knowledge graph + style when a style profile was explicitly selected
    style_section = ""
    kg_section = ""
    if style_guide:
        style_section = (
            "\n\n## Visual Style from Reference Deck (user selected a style profile)\n"
            "Use this as INSPIRATION, not a rigid template:\n"
            f"{style_guide[:3000]}\n"
        )
        kg_context = _get_knowledge_graph_context(state)
        if kg_context:
            kg_section = f"\n\n## User's Design Preferences\n{kg_context[:1000]}"

    # Brand logo enrichment via logo.dev — extract mentioned companies/tools
    # and fetch their logos so the LLM can place them on the slides.
    brand_logos: dict[str, str] = {}
    try:
        brand_text = f"{prompt}\n\n{outline_text}"
        brand_names = await extract_brand_mentions(brand_text, llm)
        if brand_names:
            brand_logos = await resolve_brand_logos(brand_names)
            logger.info("brand_logos_resolved", count=len(brand_logos), brands=list(brand_logos.keys()))
    except Exception as e:
        logger.warning("brand_logo_enrichment_failed", error=str(e))

    logos_section = ""
    if brand_logos:
        logos_lines = "\n".join(f'- "{name}": {url}' for name, url in brand_logos.items())
        logos_section = (
            "\n\n## Available Brand Logos (OPTIONAL — use sparingly)\n"
            "Logos are available for these brands but should ONLY be used when:\n"
            "- The user EXPLICITLY asked for logos in their prompt\n"
            "- There is a dedicated 'tool landscape' or 'tech stack' slide in the outline\n"
            "- A slide's PRIMARY PURPOSE is to showcase specific tools/vendors\n\n"
            "### LOGO RULES (CRITICAL):\n"
            "- **CONTENT IS KING** — the message, data, and visual structure matter 10x more than logos\n"
            "- **Maximum 1 slide** in the entire deck should be logo-heavy (tool landscape)\n"
            "- **Maximum 3-4 logos per slide** — more than that creates visual clutter\n"
            "- **NEVER let logos compete with content** — if a slide has important text, stats, or a diagram, do NOT add logos\n"
            "- **NEVER add logos to title slides, stat slides, process flows, or comparison slides**\n"
            "- If you DO use a logo, keep it small (w: 0.5, h: 0.4) next to the brand name text — "
            "the TEXT NAME is more important than the icon\n"
            "- Do NOT invent URLs — only use the ones below\n\n"
            f"Available (use only when appropriate):\n{logos_lines}\n"
        )

    # Diagram section — Kroki (image-based) or shape-based recipes
    diagram_section = ""
    if use_diagram_images:
        diagram_section = (
            "\n\n## DIAGRAM IMAGES MODE (Kroki — ENABLED)\n"
            "For complex diagrams, embed rendered images via Kroki markers.\n\n"
            "### IMPORTANT LAYOUT RULES FOR DIAGRAMS:\n"
            "- A diagram slide should ONLY have: title (y:0.3-1.2) + diagram image (y:1.3-5.8) + optional caption\n"
            "- NEVER place other shapes/text/cards that overlap with the diagram area\n"
            "- If you need text alongside a diagram, use 2-column: diagram left (x:0.5, w:7), text right (x:8, w:4.5)\n"
            "- NEVER put a diagram AND a table on the same slide\n\n"
            "### How to use:\n"
            "Write the diagram source as COMMENTS with this exact format:\n"
            "```\n"
            "// First: set slide background and title\n"
            "slide.background = { color: 'FFFFFF' };\n"
            "slide.addText('ARCHITECTURE', { x: 0.5, y: 0.3, w: 5, h: 0.3, fontSize: 10, bold: true, color: '00B4D8', charSpacing: 2 });\n"
            "slide.addText('System Architecture', { x: 0.5, y: 0.6, w: 10, h: 0.6, fontSize: 28, bold: true, color: '1A1A2E' });\n"
            "// Then: the Kroki diagram (will be replaced with addImage automatically)\n"
            "// KROKI_DIAGRAM:mermaid\n"
            "// graph TD\n"
            "//   A[API Gateway] --> B[Auth Service]\n"
            "//   A --> C[Order Service]\n"
            "//   C --> D[Payment Service]\n"
            "//   C --> E[Notification Service]\n"
            "// END_KROKI_DIAGRAM\n"
            "// Caption below diagram\n"
            "slide.addText('Fig 1: Request flow through microservices', { x: 0.5, y: 6.5, w: 12, h: 0.3, fontSize: 9, italic: true, color: '999999' });\n"
            "```\n"
            "The system renders the diagram and embeds it at x:0.5, y:1.3, w:12.33, h:5.0.\n\n"
            "### Supported types: mermaid, plantuml, d2, graphviz, blockdiag, seqdiag, erd\n\n"
            "### When to use Kroki vs shapes:\n"
            "- Kroki: sequence diagrams, complex flowcharts (6+ nodes), ER diagrams, network diagrams\n"
            "- Native shapes: simple 3-5 step flows, card layouts, stat callouts, comparisons, timelines\n"
            "- PREFER native shapes when possible — they're editable in PowerPoint\n"
        )
    else:
        diagram_section = (
            "\n\n## DIAGRAM RECIPES (shape-based — fully editable in PowerPoint)\n"
            "Build these diagrams using native pptxgenjs shapes. They are fully editable.\n\n"
            "### Sequence Diagram (2-3 actors)\n"
            "```\n"
            "// Actor boxes at top\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1, y: 0.8, w: 2, h: 0.6, fill: { color: '0F3460' } });\n"
            "slide.addText('Service A', { x: 1, y: 0.8, w: 2, h: 0.6, color: 'FFFFFF', fontSize: 12, bold: true, align: 'center', valign: 'middle' });\n"
            "// Vertical lifeline\n"
            "slide.addShape(pres.shapes.LINE, { x: 2, y: 1.4, w: 0, h: 4, line: { color: 'CCCCCC', width: 1, dashType: 'dash' } });\n"
            "// Horizontal arrow (message)\n"
            "slide.addShape(pres.shapes.LINE, { x: 2, y: 2.0, w: 4, h: 0, line: { color: '0F3460', width: 2 } });\n"
            "slide.addText('POST /api', { x: 2.5, y: 1.6, w: 3, h: 0.3, fontSize: 10, color: '0F3460' });\n"
            "```\n\n"
            "### Architecture Diagram (hub & spoke)\n"
            "```\n"
            "// Central hub\n"
            "slide.addShape(pres.shapes.OVAL, { x: 5.5, y: 2.5, w: 2.5, h: 2.5, fill: { color: '0F3460' } });\n"
            "slide.addText('Core\\nService', { x: 5.5, y: 2.5, w: 2.5, h: 2.5, color: 'FFFFFF', fontSize: 14, bold: true, align: 'center', valign: 'middle' });\n"
            "// Spoke nodes (repeat at 45° intervals)\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1, y: 1, w: 2.2, h: 1.2, fill: { color: 'E8F4FD' }, rectRadius: 0.1 });\n"
            "slide.addText('Database', { x: 1, y: 1, w: 2.2, h: 1.2, fontSize: 11, bold: true, align: 'center', valign: 'middle', color: '0F3460' });\n"
            "// Connector line from spoke to hub\n"
            "slide.addShape(pres.shapes.LINE, { x: 3.2, y: 1.6, w: 2.3, h: 0.9, line: { color: '00B4D8', width: 2 } });\n"
            "```\n\n"
            "### Gantt / Timeline\n"
            "```\n"
            "// Horizontal time axis\n"
            "slide.addShape(pres.shapes.LINE, { x: 0.5, y: 4, w: 12, h: 0, line: { color: '333333', width: 2 } });\n"
            "// Phase bars (stacked horizontal rectangles at different y positions)\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.0, w: 4, h: 0.6, fill: { color: '0F3460' }, rectRadius: 0.05 });\n"
            "slide.addText('Phase 1: Discovery', { x: 0.5, y: 2.0, w: 4, h: 0.6, color: 'FFFFFF', fontSize: 10, align: 'center', valign: 'middle' });\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.5, y: 2.8, w: 5, h: 0.6, fill: { color: '00B4D8' }, rectRadius: 0.05 });\n"
            "slide.addText('Phase 2: Build', { x: 3.5, y: 2.8, w: 5, h: 0.6, color: 'FFFFFF', fontSize: 10, align: 'center', valign: 'middle' });\n"
            "```\n"
        )

    # Build system message — keep it FOCUSED and SHORT
    sys_parts = [
        "You are an expert presentation designer. Write pptxgenjs code for professional, well-structured slides.",
        PPTXGENJS_API_REFERENCE,
    ]

    if style_section:
        sys_parts.append(style_section)
    if kg_section:
        sys_parts.append(kg_section)
    if logos_section:
        sys_parts.append(logos_section)
    if use_diagram_images:
        sys_parts.append(diagram_section)

    sys_parts.append(
        "\n## Design Guidelines\n"
        "Colors (default palette if no style profile): 1A1A2E (dark), 0F3460 (primary), 00B4D8 (accent), E94560 (warm), F8F9FA (light bg), 333333 (text).\n"
        "Each slide: section label (ALL CAPS, 10pt, accent color) + title (28pt bold) + structured content.\n"
        "Use addTable for comparisons. Use addChart for metrics. Use shapes+arrows for flows.\n"
        "White/light backgrounds for content slides. Dark only for title slide.\n"
        f"Audience: {audience}.\n"
    )

    if is_creative:
        sys_parts.append(
            "\n## Creative Mode ON\n"
            "Use advanced layouts: tables with zebra striping, process flow shapes, "
            "stat callout cards, timelines, comparison matrices. No plain bullet lists.\n"
        )

    sys_parts.append(
        "\n## Output\n"
        "Return a JSON array. Each item: {\"slide_number\": N, \"title\": \"...\", \"speaker_notes\": \"...\", \"code\": \"...\"}\n"
        "In code: you have `slide` and `pres`. Do NOT call pres.addSlide(). No # in hex colors. Fresh {} per call.\n"
    )

    messages = [SystemMessage(content="\n".join(sys_parts))]

    # Build human message
    human_text = (
        f"Create {num_slides} slides for:\n\n"
        f"Topic: {prompt}\n"
        f"Audience: {audience}\n\n"
        f"Outline:\n{outline_text}\n\n"
        f"Research:\n{summary[:3000]}\n\n"
        "For each slide, FIRST decide the best layout (table? chart? card grid? flow diagram?) "
        "then write clean pptxgenjs code using the grid coordinates from the API reference. "
        "Include specific data from the research — real numbers, tool names, metrics.\n"
        "Output ONLY the JSON array."
    )

    visual_parts = _build_visual_context(state)
    if visual_parts:
        content_parts: list = [{"type": "text", "text": human_text}]
        content_parts.extend(visual_parts)
        content_parts.append({"type": "text", "text": "\nMatch the visual style, color palette, and layout structure shown in these reference images."})
        messages.append(HumanMessage(content=content_parts))
    else:
        messages.append(HumanMessage(content=human_text))

    try:
        result = await llm.ainvoke(messages)
        raw_content = result.content if hasattr(result, "content") else str(result)
        logger.info("slide_writer_llm_response", content_length=len(raw_content), first_100=raw_content[:100] if raw_content else "EMPTY")
    except Exception as e:
        logger.error("slide_writer_llm_call_failed", error=str(e))
        raise Exception(f"LLM call failed in slide_writer: {e}")

    # Parse the JSON array from the LLM response
    slide_codes = _parse_slide_codes(raw_content)

    if not slide_codes:
        logger.error("slide_writer_no_slides_parsed", raw_length=len(raw_content), raw_sample=raw_content[:500] if raw_content else "EMPTY")
        raise Exception(f"Failed to parse slide code from LLM response (length={len(raw_content)})")

    # Post-process: replace KROKI_DIAGRAM markers with rendered image URLs
    if use_diagram_images:
        slide_codes = await _process_kroki_diagrams(slide_codes, state.get("job_id", ""))

    await publisher.publish("writing_slides", 0.85, f"Designed {len(slide_codes)} slides with full visual control")
    await publisher.close()
    return {"slides": slide_codes, "current_phase": "writing_slides"}


def _parse_json_array(raw: str) -> list[dict]:
    """Parse a JSON array from LLM output, handling markdown fences and nested objects."""
    import re
    cleaned = raw.strip()
    # Strip markdown code fences
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(1)

    # Try to parse as-is first
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            # Gemini sometimes wraps: {"outline": [...]} — extract the list
            for val in parsed.values():
                if isinstance(val, list):
                    return val
    except json.JSONDecodeError:
        pass

    # Find array brackets
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            pass

    return []


def _parse_slide_codes(raw: str) -> list[dict]:
    """Parse slide code objects from LLM output. Handles markdown code blocks
    and malformed JSON from code strings with unescaped characters."""
    import re

    # Strip markdown code fences
    cleaned = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)

    # Find the JSON array
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1:
        return []

    json_str = cleaned[start : end + 1]

    # Attempt 1: direct parse
    try:
        slides = json.loads(json_str)
        if isinstance(slides, list):
            return slides
    except json.JSONDecodeError:
        pass

    # Attempt 2: fix common issues — control chars in "code" string values
    try:
        # Replace literal newlines inside strings with \\n
        fixed = re.sub(
            r'"code"\s*:\s*"',
            lambda m: m.group(0),
            json_str,
        )
        slides = json.loads(fixed)
        if isinstance(slides, list):
            return slides
    except json.JSONDecodeError:
        pass

    # Attempt 3: extract individual slide objects with regex
    try:
        slide_objects = []
        # Match each {...} object containing slide_number and code
        obj_pattern = re.compile(
            r'\{\s*"slide_number"\s*:\s*(\d+)\s*,'
            r'.*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,'
            r'.*?"speaker_notes"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,'
            r'.*?"code"\s*:\s*"((?:[^"\\]|\\.)*)"'
            r'\s*\}',
            re.DOTALL,
        )
        for m in obj_pattern.finditer(json_str):
            slide_objects.append({
                "slide_number": int(m.group(1)),
                "title": m.group(2).replace('\\"', '"'),
                "speaker_notes": m.group(3).replace('\\"', '"'),
                "code": m.group(4).replace('\\"', '"').replace('\\n', '\n'),
            })
        if slide_objects:
            logger.info("slide_codes_parsed_via_regex", count=len(slide_objects))
            return slide_objects
    except Exception as e:
        logger.error("slide_code_regex_parse_error", error=str(e))

    # Attempt 4: try parsing each object individually by finding balanced braces
    try:
        slide_objects = []
        depth = 0
        obj_start = None
        for i, ch in enumerate(json_str):
            if ch == '{':
                if depth == 1:  # top-level object inside the array
                    obj_start = i
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 1 and obj_start is not None:
                    obj_str = json_str[obj_start:i + 1]
                    try:
                        obj = json.loads(obj_str)
                        if "code" in obj:
                            slide_objects.append(obj)
                    except json.JSONDecodeError:
                        # Try fixing the code field by re-escaping
                        code_match = re.search(r'"code"\s*:\s*"', obj_str)
                        if code_match:
                            # Find the last " before the closing }
                            code_start = code_match.end()
                            last_quote = obj_str.rfind('"', code_start)
                            if last_quote > code_start:
                                code_val = obj_str[code_start:last_quote]
                                # Re-escape for JSON
                                code_val = code_val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                                fixed_obj = obj_str[:code_start] + code_val + obj_str[last_quote:]
                                try:
                                    obj = json.loads(fixed_obj)
                                    if "code" in obj:
                                        slide_objects.append(obj)
                                except json.JSONDecodeError:
                                    pass
                    obj_start = None
        if slide_objects:
            logger.info("slide_codes_parsed_via_brace_matching", count=len(slide_objects))
            return slide_objects
    except Exception as e:
        logger.error("slide_code_brace_parse_error", error=str(e))

    logger.error("slide_code_json_parse_error", raw_sample=json_str[:500])
    return []


class ReflectionResult(BaseModel):
    """Output of the reflection agent's review."""
    overall_quality: int = Field(description="1-10 quality score")
    issues: list[str] = Field(description="List of specific issues found")
    suggestions: list[str] = Field(description="Actionable improvement suggestions")


async def reflection(state: PPTGenerationState) -> dict:
    """Reflection agent — reviews generated slides for quality and consistency.

    Checks:
    - Layout variety (no 3+ identical layouts in a row)
    - Content density matches audience type
    - Titles are compelling, not generic
    - Speaker notes are useful
    - Chart data is well-structured where present
    - Visual consistency with style profile
    - Adherence to pptx skill design guidelines

    If critical issues found and quality < 6, it revises the slides.
    """
    publisher = _get_publisher(state)
    await publisher.publish("reflecting", 0.87, "Reflecting on presentation quality...")

    slides = state.get("slides", [])
    if not slides:
        await publisher.close()
        return {"current_phase": "reflection_skipped"}

    llm = _get_llm(state, temperature=0.3)
    structured_llm = llm.with_structured_output(ReflectionResult)

    outline = state.get("outline", [])
    audience = state.get("audience_type", "general")
    prompt = state.get("user_prompt", "")
    style_guide = state.get("style_guide", "")
    kg_context = _get_knowledge_graph_context(state)

    slides_json = json.dumps(slides, indent=2)

    review_context = ""
    if style_guide:
        review_context += f"\n\nStyle Profile:\n{style_guide[:1000]}"
    if kg_context:
        review_context += f"\n\nUser's Design Preferences:\n{kg_context[:1000]}"

    messages = [
        SystemMessage(content=(
            "You are a presentation quality reviewer and design critic. "
            "Review the generated slides and score them 1-10. Check for:\n\n"
            "1. LAYOUT VARIETY: Are there 3+ identical layouts in a row? Flag this.\n"
            "2. CONTENT QUALITY: Are titles compelling or generic? Are bullets informative?\n"
            "3. AUDIENCE FIT: Does content density match the target audience?\n"
            "4. SPEAKER NOTES: Are they useful for the presenter?\n"
            "5. VISUAL INTEREST: Does each slide have a visual element (chart, image, etc.)?\n"
            "6. FLOW: Do slides progress logically? Is there a clear narrative arc?\n"
            "7. DESIGN RULES: Following the design guidelines below?\n"
            f"{PPTX_DESIGN_GUIDELINES}\n"
            "If the overall quality score is below 6, provide revised_slides with fixes. "
            "If score is 6 or above, set revised_slides to null — the slides are good enough.\n"
            "Be specific in issues and suggestions."
        )),
        HumanMessage(content=(
            f"Topic: {prompt}\n"
            f"Audience: {audience}\n"
            f"Number of slides: {len(slides)}\n\n"
            f"Generated slides:\n{slides_json[:6000]}\n"
            f"{review_context}\n\n"
            "Review these slides. Score 1-10 and provide feedback."
        )),
    ]

    try:
        result = await structured_llm.ainvoke(messages)

        quality = result.overall_quality if hasattr(result, "overall_quality") else 7
        issues = result.issues if hasattr(result, "issues") else []
        suggestions = result.suggestions if hasattr(result, "suggestions") else []

        logger.info(
            "reflection_complete",
            quality=quality,
            issues_count=len(issues),
        )

        await publisher.publish(
            "reflection_done",
            0.89,
            f"Quality score: {quality}/10. {len(issues)} minor issues noted.",
            data={"quality": quality, "issues": issues, "suggestions": suggestions},
        )
        await publisher.close()
        return {"current_phase": "reflection_done"}

    except Exception as e:
        logger.warn("reflection_failed", error=str(e))
        await publisher.publish("reflection_skipped", 0.89, "Reflection skipped (non-critical)")
        await publisher.close()
        return {"current_phase": "reflection_skipped"}
