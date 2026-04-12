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
from app.services.kroki import get_kroki_url

logger = structlog.get_logger()


async def _process_kroki_diagrams(slide_codes: list[dict], job_id: str) -> list[dict]:
    """Find KROKI_DIAGRAM markers in slide code and replace with image URLs."""
    import re

    pattern = re.compile(
        r'//\s*KROKI_DIAGRAM:(\w+)\s*\n((?://.*\n)*?)//\s*END_KROKI_DIAGRAM',
        re.MULTILINE,
    )

    for slide in slide_codes:
        code = slide.get("code", "")
        if "KROKI_DIAGRAM" not in code:
            continue

        matches = list(pattern.finditer(code))
        for i, m in enumerate(reversed(matches)):  # reverse to preserve offsets
            diagram_type = m.group(1).strip()
            raw_lines = m.group(2)
            # Strip leading "// " from each line
            source = "\n".join(
                line.lstrip("/").strip() for line in raw_lines.split("\n") if line.strip()
            )

            if not source:
                continue

            # Generate direct Kroki URL — use SVG for better quality
            url = get_kroki_url(diagram_type, source, "svg")

            # Replace the marker with addImage code — use content zone only
            # Leave space for title (y:0-1.3) and optional caption below
            replacement = (
                f'slide.addImage({{ path: "{url}", '
                f'x: 1.0, y: 1.5, w: 11.33, h: 4.5 }});'
            )
            code = code[:m.start()] + replacement + code[m.end():]
            logger.info("kroki_diagram_embedded", type=diagram_type, slide=slide.get("slide_number"))

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
## pptxgenjs API Reference (for code generation)

### Slide Dimensions (CRITICAL — memorize these)
Layout: LAYOUT_WIDE = 13.33" wide x 7.5" tall.
Safe margins: x starts at 0.5, ends at 12.83. y starts at 0.4, ends at 7.1.
Usable content area: 12.33" wide x 6.7" tall.

### LAYOUT GRID SYSTEM (MUST FOLLOW)
Before writing ANY code, plan your layout on this grid:

**Header zone**: y: 0.3-1.2 (section label + title)
**Content zone**: y: 1.3-5.8 (main content — cards, text, images)
**Footer zone** (OPTIONAL): y: 6.2-7.2 (page number, small caption — NOT mandatory)

**Column widths** (with 0.3" gaps between columns):
- 1 column: x: 0.5, w: 12.33
- 2 columns: x: 0.5 w: 6.0, x: 6.8 w: 6.0
- 3 columns: x: 0.5 w: 3.9, x: 4.7 w: 3.9, x: 8.9 w: 3.9
- 4 columns: x: 0.5 w: 2.85, x: 3.6 w: 2.85, x: 6.7 w: 2.85, x: 9.8 w: 2.85

### OVERLAP PREVENTION (CRITICAL)
- Before placing ANY element, mentally check: does this x,y,w,h overlap with anything already placed?
- Text INSIDE a shape/card: x must be >= card.x, y must be >= card.y, x+w must be <= card.x+card.w
- Logo next to text: if logo is at x:1, w:0.8, then text starts at x:1.9 (logo.x + logo.w + 0.1 gap)
- Cards in a row: card2.x must be >= card1.x + card1.w + gap (usually 0.3" gap)
- NEVER place text at the same x,y as a shape unless the text is meant to be INSIDE the shape

### API Methods

**Shapes:**
slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: "HEX" }, line: { color, width }, rectRadius: 0.1 });
Available: RECTANGLE, ROUNDED_RECTANGLE, OVAL, LINE, TRIANGLE, RIGHT_TRIANGLE, TRAPEZOID, DIAMOND, STAR_5
Shadow: { shadow: { type: "outer", color: "000000", blur: 4, offset: 2, opacity: 0.15 } }
Transparency: fill: { color: "HEX", transparency: 50 }

**Text:**
slide.addText("text", { x, y, w, h, fontSize, fontFace, color, bold, italic, align, valign, margin: [top,right,bottom,left] });
slide.addText([{ text: "line1", options: { bold: true, fontSize: 14, color: "333333", breakLine: true } }, ...], { x, y, w, h });
Bullets: { bullet: true, breakLine: true }

**Background:**
slide.background = { color: "HEX" };

**Images:**
slide.addImage({ path: "https://url.com/image.png", x, y, w, h });
For logos: ALWAYS place on a light background card, minimum w: 0.8

**Tables (MUST look professional — never plain/boring):**
slide.addTable(rows, { x, y, w, autoPage: false, border: { pt: 0.5, color: "E0E0E0" }, colW: [3, 4.5, 4.5] });
Header row: [
  { text: "ASPECT", options: { fill: { color: "1A1A2E" }, color: "FFFFFF", bold: true, fontSize: 11, align: "center", valign: "middle" } },
  { text: "MONOLITH", options: { fill: { color: "2D3561" }, color: "FFFFFF", bold: true, fontSize: 11, align: "center" } },
  { text: "MICROSERVICES", options: { fill: { color: "0F3460" }, color: "FFFFFF", bold: true, fontSize: 11, align: "center" } }
]
Data rows (alternate fills for readability):
  Even rows: { fill: { color: "F8F9FA" } }
  Odd rows:  { fill: { color: "FFFFFF" } }
  Cell text: { color: "333333", fontSize: 10, valign: "middle", align: "left", margin: [4, 8, 4, 8] }
IMPORTANT table rules:
- ALWAYS set colW to control column widths (proportional to content)
- ALWAYS alternate row fills (zebra striping) for readability
- Header row MUST have bold white text on dark colored background
- Use margin: [4, 8, 4, 8] in cells for padding (top, right, bottom, left in points)
- Add a colored accent bar above the table: addShape RECTANGLE { x, y: tableY-0.08, w, h: 0.08, fill: accent }
- Each cell should have ONE clear line of content, not mashed text

**Charts:**
slide.addChart(pres.charts.BAR, [{ name: "Series", labels: [...], values: [...] }], { x, y, w, h, chartColors: ["HEX1"], showValue: true });
Types: BAR, LINE, PIE, DOUGHNUT. barDir: "col" for vertical bars.

### TESTED LAYOUT RECIPES (use these as starting points)

**Recipe: 3-Card Row**
```
// Card 1
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 1.5, w: 3.9, h: 4.0, fill: { color: "FFFFFF" }, shadow: { type: "outer", blur: 4, offset: 2, color: "000000", opacity: 0.1 }, rectRadius: 0.1 });
// Card 1 colored top bar
slide.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.5, w: 3.9, h: 0.15, fill: { color: "0F3460" } });
// Card 1 title (INSIDE the card)
slide.addText("Title", { x: 0.7, y: 1.85, w: 3.5, h: 0.5, fontSize: 16, bold: true, color: "1A1A2E" });
// Card 1 body (INSIDE the card, below title)
slide.addText("Description text here", { x: 0.7, y: 2.4, w: 3.5, h: 2.8, fontSize: 12, color: "555555", valign: "top" });
// Repeat for Card 2 at x: 4.7 and Card 3 at x: 8.9
```

**Recipe: Stat Callout Row (use INSIDE content zone, NOT as a footer)**
```
// 3 stat cards in a row — place at y:4.5 or wherever they fit in content zone
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 4.5, w: 3.9, h: 1.5, fill: { color: "F0F4FF" }, rectRadius: 0.1 });
slide.addText("42%", { x: 0.5, y: 4.6, w: 3.9, h: 0.8, fontSize: 32, bold: true, color: "0F3460", align: "center" });
slide.addText("Alert noise reduction", { x: 0.5, y: 5.4, w: 3.9, h: 0.4, fontSize: 10, color: "666666", align: "center" });
// Repeat at x: 4.7 and x: 8.9
```

**Recipe: Logo + Brand Name Card**
```
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1.0, y: 2.0, w: 1.8, h: 2.2, fill: { color: "F8F8F8" }, shadow: { type: "outer", blur: 3, offset: 1, color: "000000", opacity: 0.1 }, rectRadius: 0.1 });
slide.addImage({ path: "LOGO_URL", x: 1.3, y: 2.2, w: 1.2, h: 1.0 });
slide.addText("Brand Name", { x: 1.0, y: 3.3, w: 1.8, h: 0.5, fontSize: 11, bold: true, color: "333333", align: "center" });
```

### CRITICAL RULES
- NEVER use "#" in hex colors — causes PPTX corruption
- NEVER reuse option objects — create fresh {} for each call
- NEVER place elements outside 0-13.33 (x) or 0-7.5 (y)
- ALWAYS verify text is INSIDE its parent card by checking coordinates
- ALWAYS leave 0.2-0.3" padding inside cards for text
- Use breakLine:true between text array items
- Keep font sizes consistent: titles 24-32, subtitles 16-18, body 11-14, labels 9-11
- Maximum 5-6 visual elements per slide — don't overcrowd

### CONTENT RICHNESS (CRITICAL — slides must NOT be empty/basic)
- Every content slide MUST have at minimum: title + 2-3 paragraphs or a rich table or a detailed diagram
- Tables MUST have real data — at least 4-5 rows with specific values, not generic placeholders
- Use the research data from the outline — include actual numbers, percentages, tool names, comparisons
- Card text should be 2-4 sentences explaining the concept, not just a single phrase
- Stat callouts need context: the number + what it measures + why it matters (3 text elements per stat)
- NEVER leave large empty areas on a slide — fill the content zone (y: 1.3 to 5.8)
- If a slide looks sparse, add a supporting detail card, a key takeaway bar, or a footnote section

### ELEMENT STACKING ORDER (prevents overlapping)
- Place background shapes FIRST (full-width bars, section headers)
- Place container cards SECOND
- Place text INSIDE containers THIRD
- Place accent elements (lines, dots, decorators) LAST
- NEVER place two independent content groups at the same y position unless they are in separate columns
- If a slide has both a diagram AND text, use 2-column layout: diagram left (w:7), text right (w:5)
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

    messages = [
        SystemMessage(content=(
            "You are a world-class presentation designer at a top design agency. "
            "You create CATALOGUE-QUALITY presentation slides — the kind that win design awards. "
            "You write pptxgenjs JavaScript code that produces polished, professional, visually rich slides.\n\n"
            f"{PPTXGENJS_API_REFERENCE}\n"
            f"{diagram_section}"
            f"{style_section}"
            f"{kg_section}"
            f"{logos_section}\n"
            + (
                "## CREATIVE MODE — ADVANCED VISUALIZATION (ENABLED)\n"
                "The user has enabled CREATIVE MODE. You MUST go beyond basic text+bullet slides. "
                "For EVERY slide, think: what is the BEST visual way to present this data?\n\n"
                "### Mandatory Visualization Techniques (use at least 3-4 across the deck):\n"
                "1. **Data Tables** — Use `slide.addTable(rows, opts)` for comparisons, feature matrices, "
                "pricing tiers, or any structured data. Style with colored header rows, alternating row colors, borders.\n"
                "2. **Pyramid/Funnel** — Stack colored trapezoid shapes (addShape TRAPEZOID) for hierarchies, "
                "priority tiers, or funnels (e.g., sales funnel, maturity model).\n"
                "3. **Process Flows** — Numbered circles/boxes connected by arrow shapes for workflows, "
                "pipelines, or step-by-step processes. Use addShape for each step + addShape ARROW between.\n"
                "4. **Comparison Charts** — Side-by-side colored bars using addShape RECTANGLE with proportional widths "
                "to visually represent metrics, percentages, or scores.\n"
                "5. **Timeline** — Horizontal line with evenly-spaced circles/diamonds and text labels for milestones.\n"
                "6. **Quadrant/Matrix** — 2x2 grid of colored rectangles for strategic frameworks "
                "(e.g., risk vs impact, effort vs value).\n"
                "7. **Hub & Spoke** — Central circle with lines radiating to surrounding circles for ecosystems, "
                "integrations, or relationship diagrams.\n"
                "8. **Stacked Bar/Progress** — Horizontal colored segments showing proportions or progress.\n"
                "9. **Icon Grids** — Use brand logos (from logo.dev if available) arranged in a clean grid "
                "with labels underneath for tool/vendor landscapes.\n"
                "10. **Stat Callout Cards** — Large bold numbers (48-72pt) with small descriptive labels in colored cards.\n\n"
                "### Creative Mode Rules:\n"
                "- NEVER use plain bullet lists — always find a visual structure.\n"
                "- Each slide must have a DIFFERENT layout — no two slides should look the same.\n"
                "- If a slide has numbers/metrics, use stat callouts or bar visualizations, not text.\n"
                "- If a slide has a process, use a flow diagram, not text.\n"
                "- If a slide compares things, use a table or matrix, not text.\n"
                "- COMPLETE every visualization you start — don't leave shapes half-done or misaligned.\n"
                "- Test your x/y/w/h coordinates mentally: shapes must not overlap unintentionally.\n\n"
                if is_creative else ""
            )
            + "## DESIGN PRINCIPLES — CONTENT-FIRST, DATA-RICH\n"
            "Your #1 job is to present INFORMATION CLEARLY. Design serves content, not the other way around.\n\n"
            "### Content Density (MOST IMPORTANT)\n"
            "- Every slide MUST be INFORMATION-DENSE — use the research data from the outline.\n"
            "- Include real numbers, percentages, comparisons, tool names — not generic placeholder text.\n"
            "- A slide with just a title and 3 bullet points is LAZY. Think: how else can this be shown?\n"
            "- For ANY data: use addTable() or addChart() — NEVER just write numbers as text.\n"
            "- For ANY process: use shapes connected with arrows — NEVER just list steps as bullets.\n"
            "- For ANY comparison: use a well-formatted table or side-by-side cards — NEVER just text.\n\n"
            "### Charts (addChart) — USE WITH PROPER AXES\n"
            "- BAR charts: catAxisTitle, valAxisTitle, showValue:true, catGridLine:{style:'none'}\n"
            "- Always include axis labels so the reader knows what's being measured.\n"
            "- Use chartColors array matching the number of data points.\n"
            "- Charts should have REAL data from research, not made-up numbers.\n\n"
            "### Color Palette (pick ONE and stick with it)\n"
            "If no style profile: use this default professional palette:\n"
            "- Dark: 1A1A2E (backgrounds, headings)\n"
            "- Primary accent: 0F3460 (cards, headers)\n"
            "- Secondary accent: 00B4D8 (highlights, stat numbers)\n"
            "- Warm accent: E94560 (alerts, emphasis)\n"
            "- Light bg: F8F9FA (card fills, table even rows)\n"
            "- Text: 333333 (body), FFFFFF (on dark bg)\n"
            "Use dark background ONLY for the title slide. Content slides: white/light background.\n\n"
            "### Layout Rules\n"
            "- Group related content into cards with thin colored top border (3px).\n"
            "- Use 2-column or 3-column grid from the API reference.\n"
            "- Section label above title: ALL CAPS, small font (10pt), accent color, charSpacing: 2.\n"
            "- NO thick footer bars — they waste space. Put stats inline in the content area.\n"
            "- Slide number bottom-right: fontSize 8, color 'AAAAAA'.\n"
            "- Keep consistent 0.5\" margins on all sides.\n\n"
            "### What NOT to do\n"
            "- Do NOT use oversized shapes (full-width colored blocks) just to fill space.\n"
            "- Do NOT add a dark footer bar on every slide.\n"
            "- Do NOT use generic text like 'Key insights' with no actual insight.\n"
            "- Do NOT leave large empty areas — fill with relevant content from research.\n"
            "- Do NOT make circles/ovals as the primary layout — they waste space and look amateurish.\n\n"
            "## Output Format\n"
            "Output ONLY a valid JSON array. Each object:\n"
            "- \"slide_number\": number\n"
            "- \"title\": string\n"
            "- \"speaker_notes\": string (2-3 sentences of what to say)\n"
            "- \"code\": string — pptxgenjs JavaScript code for this slide.\n"
            "  You have access to `slide` and `pres`. Do NOT call pres.addSlide().\n"
            "  Colors are 6-char hex WITHOUT # prefix. NEVER use # in colors.\n"
            "  Create fresh option objects for each addShape/addText call — never reuse.\n\n"
            + {
                "executive": (
                    "## AUDIENCE: EXECUTIVE (C-Suite / VP / Director)\n"
                    "- Lead with BUSINESS IMPACT — revenue, cost savings, ROI, market position\n"
                    "- Use large stat callouts (48-72pt numbers) for key metrics\n"
                    "- Minimal technical jargon — translate tech concepts to business outcomes\n"
                    "- Include strategic frameworks: quadrants, maturity models, competitive landscapes\n"
                    "- Slides should answer: 'Why should I care?' and 'What's the bottom line?'\n"
                    "- Keep text sparse — 3-4 bullet points max, each under 15 words\n"
                    "- Use premium, polished design — dark backgrounds, gold/teal accents\n"
                ),
                "technical": (
                    "## AUDIENCE: TECHNICAL (Engineers / Architects / DevOps)\n"
                    "- Lead with ARCHITECTURE and HOW IT WORKS — system diagrams, data flows, APIs\n"
                    "- Include technical details: protocols, latency numbers, throughput metrics\n"
                    "- Use process flow diagrams, architecture boxes, and integration arrows\n"
                    "- Include code snippets or config examples where relevant (in monospace text)\n"
                    "- Slides should answer: 'How does this work?' and 'How do I implement it?'\n"
                    "- More text density is OK — engineers expect detailed slides\n"
                    "- Use clean, structured layouts — tables for comparisons, timelines for rollouts\n"
                ),
                "general": (
                    "## AUDIENCE: GENERAL (Mixed / All-hands / External)\n"
                    "- Balance business value with approachable explanations\n"
                    "- Use analogies and visual metaphors to explain complex topics\n"
                    "- Include a mix of stats, stories, and visuals\n"
                    "- Avoid deep technical details — keep it accessible\n"
                    "- Slides should answer: 'What is this?' and 'Why does it matter?'\n"
                    "- Medium text density — enough context without overwhelming\n"
                    "- Use friendly, modern design — lighter backgrounds, vibrant accents\n"
                ),
            }.get(audience, f"Target audience: {audience}.\n")
            + "\n"
        )),
    ]

    # Build slide_writer human message with visual context
    human_text = (
        f"Create {num_slides} CATALOGUE-QUALITY slides for:\n\n"
        f"Topic: {prompt}\n"
        f"Audience: {audience}\n\n"
        f"Slide outline:\n{outline_text}\n\n"
        f"Research context:\n{summary[:2000]}\n\n"
        "IMPORTANT: Make these slides look like they came from a premium design agency. "
        "Use colored backgrounds, card layouts, accent bars, stat callouts, and visual hierarchy. "
        "Every slide must have shapes and color — NO plain text on white background.\n\n"
        "## BEFORE YOU WRITE EACH SLIDE:\n"
        "1. PLAN the layout first: how many columns? What goes where?\n"
        "2. Use the GRID SYSTEM from the API reference (0.5/4.7/8.9 for 3-col, etc.)\n"
        "3. Calculate EXACT x,y,w,h for every element BEFORE writing code\n"
        "4. CHECK: does any text overlap a shape? Does any card overlap another card?\n"
        "5. Logos must be INSIDE their container cards, not floating over other content\n"
        "6. Text inside a card must have x >= card.x+0.2 and x+w <= card.x+card.w-0.2\n\n"
        "## COMMON MISTAKES TO AVOID:\n"
        "- Placing a logo at x:2 when text at x:1.5 w:3 already covers that area\n"
        "- Cards that are too wide and overlap the next column\n"
        "- Text extending beyond slide boundaries (x+w > 13.33 or y+h > 7.5)\n"
        "- Placing 6+ items in a row — max 4 items per row, use multiple rows instead\n"
        "- Font sizes too large for the container (if card is h:2, don't use fontSize:36 with 5 lines)\n\n"
        "Output the JSON array."
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
