"""Style Analyzer — deep visual analysis of PPTX files.

For each uploaded deck:
1. Convert ALL slides (or sample if >5) to high-quality images
2. Send to multimodal LLM with a detailed analysis prompt
3. Get back structured understanding of:
   - Visual structure (cards, grids, flows, shapes)
   - Color usage patterns (not just palette, but HOW colors are used)
   - Layout composition (spacing, hierarchy, content placement)
   - Information presentation style (stat callouts, timelines, comparison tables)
   - Typography treatment details
4. Store everything in the user's knowledge graph
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import structlog
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage

from app.config import settings
from app.models.schemas import ThemeConfig, LLMConfig
from app.models.style_profile import StyleProfileData, VisualStyleAnalysis, LayoutPattern
from app.services.s3 import S3Service
from app.services.extraction import ThemeExtractor
from app.services.slide_vision import pptx_to_images, images_to_base64_messages
from app.services.llm_factory import get_model

logger = structlog.get_logger()

# Maximum slides to visually analyze per file
MAX_VISUAL_SLIDES = 10


class SlideDesignAnalysis(BaseModel):
    """Deep visual analysis of a single presentation deck."""

    # Overall design language
    design_style: str = Field(description="e.g., 'Corporate enterprise with bold colors', 'Minimal tech startup', 'Dark premium with neon accents'")
    brand_personality: str = Field(description="e.g., 'Authoritative and data-driven', 'Playful and innovative'")

    # Color usage (NOT just the palette, but HOW colors are used)
    background_strategy: str = Field(description="e.g., 'Dark navy backgrounds for title/section slides, white for content slides (sandwich pattern)', 'Consistent teal gradient throughout'")
    accent_usage: str = Field(description="e.g., 'Cyan accent for headers and stat numbers, coral for warnings/alerts, gold for callouts'")
    color_blocking: str = Field(description="e.g., 'Full-width colored header bars at top of content slides', 'Colored left border on cards', 'Full-bleed colored backgrounds on section breaks'")
    primary_bg_color: str = Field(description="Most common background color as hex")
    primary_accent_color: str = Field(description="Main accent color as hex")
    secondary_accent_color: str = Field(description="Second accent color as hex")

    # Layout patterns (the STRUCTURE of how info is arranged)
    layout_patterns: list[str] = Field(description="List of specific layout patterns found, e.g., ['3-column card grid with colored top borders', 'Numbered step flow with arrows', 'Before/After two-column comparison', 'Large stat callout boxes']")
    content_arrangement: str = Field(description="How content is typically arranged on slides: 'Modular card-based', 'Full-text with accent bars', 'Visual-heavy with minimal text'")
    information_flow: str = Field(description="How slides guide the reader: 'Left-to-right numbered steps', 'Top-down hierarchy', 'Central hub with spokes'")

    # Visual elements
    shapes_used: list[str] = Field(description="Types of shapes used: 'Rounded rectangles for cards', 'Circles for step numbers', 'Lines for flow arrows', 'Full-width bars for sections'")
    decorative_elements: str = Field(description="Decorative patterns: 'Dot matrix patterns', 'Gradient overlays', 'Geometric shapes in corners', 'None'")

    # Typography
    heading_style: str = Field(description="e.g., 'Bold 36pt dark navy, left-aligned, with colored underline'")
    body_style: str = Field(description="e.g., '14pt gray on white, 1.5 line spacing, inside card containers'")
    section_labels: str = Field(description="e.g., 'ALL CAPS 10pt with letter-spacing in accent color above title'")

    # Content density
    content_density: str = Field(description="'Sparse — 3-4 bullets max per slide', 'Moderate — text + visual per slide', 'Dense — detailed multi-section slides'")
    slide_count_per_topic: str = Field(description="'One slide per concept' or 'Multiple slides building a story arc'")

    # Specific visual patterns to replicate
    signature_elements: list[str] = Field(description="The 3-5 most distinctive visual elements that make this deck unique and should be replicated. e.g., ['Dark navy cards with golden stat numbers at bottom', 'Red/orange numbered circles for process steps', 'Thin colored top border on every content card']")

    # Instructions for replication
    replication_guide: str = Field(description="A detailed paragraph describing EXACTLY how to recreate this visual style in a new presentation using pptxgenjs. Include specific colors, sizes, positions, and visual patterns.")


class StyleAnalyzer:
    """Analyzes PPTX files with deep multimodal visual understanding."""

    def __init__(self) -> None:
        self.s3 = S3Service()
        self.theme_extractor = ThemeExtractor()

    async def analyze_files(
        self,
        source_files: list[dict],
        model_config: dict | None = None,
        user_id: str | None = None,
    ) -> tuple:
        all_themes: list[ThemeConfig] = []
        all_analyses: list[SlideDesignAnalysis] = []
        file_results: dict[str, dict] = {}

        for sf in source_files:
            s3_key = sf["s3_key"]
            source_id = sf["source_id"]
            file_name = sf["file_name"]

            logger.info("analyzing_source_file", file_name=file_name)
            tmp_path = self.s3.download_to_temp(s3_key, suffix=".pptx")

            try:
                # Step 1: XML theme extraction (free)
                theme = self.theme_extractor._extract_from_file(tmp_path)
                all_themes.append(theme)

                # Step 2: Convert slides to images
                slide_images = pptx_to_images(str(tmp_path), max_slides=MAX_VISUAL_SLIDES)
                logger.info("slides_converted_to_images", file=file_name, count=len(slide_images))

                # Step 3: Deep visual analysis via multimodal LLM
                analysis = None
                if slide_images and model_config:
                    analysis = await self._deep_visual_analysis(
                        slide_images, file_name, model_config
                    )
                    if analysis:
                        all_analyses.append(analysis)

                file_results[source_id] = {
                    "slide_count": len(slide_images),
                    "theme": theme.model_dump(),
                    "visual_analysis": analysis.model_dump() if analysis else None,
                }

            finally:
                os.unlink(tmp_path)

        # Step 4: Merge themes
        merged_theme = self._merge_themes(all_themes)

        # Step 5: Build composite analysis
        visual_style = None
        layout_patterns: list[LayoutPattern] = []
        style_guide = ""

        if all_analyses:
            # Use the richest analysis (or merge multiple)
            primary = all_analyses[0]
            visual_style = VisualStyleAnalysis(
                design_language=primary.design_style,
                color_usage=primary.accent_usage,
                content_density=primary.content_density,
                visual_hierarchy=primary.information_flow,
                spacing_pattern=primary.content_arrangement,
                typography_treatment=f"Headings: {primary.heading_style}. Body: {primary.body_style}. Labels: {primary.section_labels}",
                graphic_elements=", ".join(primary.shapes_used),
                chart_style=primary.color_blocking,
                slide_transitions=primary.slide_count_per_topic,
                brand_personality=primary.brand_personality,
            )

            for pattern in primary.layout_patterns:
                layout_patterns.append(LayoutPattern(
                    layout_type=pattern[:50],
                    frequency=0.5,
                    description=pattern,
                    content_density=primary.content_density,
                    typical_elements=primary.shapes_used[:3],
                ))

            style_guide = self._build_style_guide(primary, merged_theme)

        profile_data = StyleProfileData(
            theme_colors=merged_theme.colors.model_dump(),
            heading_font=merged_theme.heading_font,
            body_font=merged_theme.body_font,
            master_background=merged_theme.master_background,
            visual_style=visual_style,
            layout_patterns=layout_patterns,
            style_guide=style_guide,
            source_file_count=len(source_files),
            total_slides_sampled=sum(r.get("slide_count", 0) for r in file_results.values()),
        )

        # Step 6: Ingest into knowledge graph
        if user_id:
            try:
                from app.services.knowledge_graph import KnowledgeGraphService
                kg = KnowledgeGraphService(user_id)
                kg.ingest_from_style_analysis(
                    theme=merged_theme,
                    visual_style=visual_style,
                    layout_patterns=layout_patterns,
                    file_name=", ".join(sf["file_name"] for sf in source_files),
                )

                # Also store the deep analysis patterns
                if all_analyses:
                    for analysis in all_analyses:
                        for sig in analysis.signature_elements:
                            kg.upsert_node("visual_element", sig[:100], {
                                "type": "signature_element",
                                "replication_guide": analysis.replication_guide[:500],
                            })
                        for pattern in analysis.layout_patterns:
                            kg.upsert_node("layout", pattern[:100], {
                                "description": pattern,
                                "shapes": analysis.shapes_used,
                            })
            except Exception as e:
                logger.error("knowledge_graph_ingest_failed", error=str(e))

        return profile_data, file_results

    async def _deep_visual_analysis(
        self,
        slide_images: list[bytes],
        file_name: str,
        model_config: dict,
    ) -> SlideDesignAnalysis | None:
        """Send slide images to multimodal LLM for deep visual analysis."""
        try:
            config = LLMConfig(
                provider=model_config.get("provider", "google"),
                model=model_config.get("model", "gemini-2.5-pro"),
                base_url=model_config.get("base_url"),
                api_key=model_config.get("api_key"),
                temperature=0.2,
                max_tokens=32000,
            )
            llm = get_model(config)
            structured_llm = llm.with_structured_output(SlideDesignAnalysis)

            image_parts = images_to_base64_messages(
                slide_images,
                labels=[f"{file_name} — Slide {i + 1}" for i in range(len(slide_images))],
            )

            content_parts: list[dict] = [
                {
                    "type": "text",
                    "text": (
                        "You are an expert presentation designer doing a FORENSIC analysis of these slides. "
                        "Your output will be used to PROGRAMMATICALLY RECREATE this exact visual style with pptxgenjs, "
                        "so vague answers are useless. Be EXHAUSTIVE and SPECIFIC. Long, detailed answers are REQUIRED.\n\n"

                        "For EVERY field in the output schema:\n"
                        "- Write 2-4 full sentences minimum (not single phrases).\n"
                        "- Include EXACT hex color codes you see (eyedropper precision).\n"
                        "- Mention specific slide numbers when describing patterns ('Slide 2 uses...').\n"
                        "- Quote exact typography sizes/weights/colors when visible.\n\n"

                        "Specific guidance per area:\n\n"

                        "1. **Colors** — Give exact hex codes. For each color, explain WHERE it appears "
                        "(backgrounds, headers, accent bars, stat numbers, card borders, dividers). "
                        "Identify the primary background color, primary accent, and 1-2 secondary accents.\n\n"

                        "2. **Background strategy** — Are there different background treatments for title vs content vs section slides? "
                        "Sandwich pattern (dark title → white content → dark closing)? Consistent gradient? Solid colors? "
                        "Describe in detail.\n\n"

                        "3. **Layout patterns** — List 5-8 SPECIFIC layout structures with details: "
                        "'3-column card grid with thin colored top borders and white interiors', "
                        "'Full-width dark footer stat bar with 4 large numbers', "
                        "'Left-aligned large heading with colored subtitle and gold underline'. "
                        "Be precise about counts, alignment, and decorative treatments.\n\n"

                        "4. **Visual elements** — List EVERY shape type you see: rounded vs sharp rectangles, "
                        "circles, arrows, lines, dot patterns, gradient overlays, geometric corners, dividers. "
                        "Mention if they're used as functional (containers) or decorative.\n\n"

                        "5. **Typography** — For headings: exact pt size (estimate), weight, font family if identifiable, "
                        "color, alignment, any underlines/decorations. For body: same details. "
                        "For section labels (small text above headers): caps treatment, color, position.\n\n"

                        "6. **Color blocking** — How are colors used as STRUCTURAL elements? "
                        "Full-width header bars? Colored left borders on cards? Full-bleed section breaks? "
                        "Colored top stripes on cards?\n\n"

                        "7. **Signature elements** — The 3-5 most DISTINCTIVE visual elements that define this brand's deck. "
                        "These are what someone would notice first. Be specific.\n\n"

                        "8. **Replication guide** — Write a LONG paragraph (5-10 sentences) describing EXACTLY how to "
                        "recreate this style with pptxgenjs. Include: slide background colors, header bar dimensions, "
                        "card border-radius, typical font sizes, accent color positions, signature decorations. "
                        "Imagine you're handing this to a junior developer who has never seen the deck.\n\n"

                        "REMEMBER: The previous run gave outputs like 'Modern corporate' for design_style and 'None' for "
                        "decorative_elements. That is COMPLETELY INSUFFICIENT. Every field deserves multiple sentences "
                        "of dense, specific observation. Be the expert designer who notices everything."
                    ),
                }
            ]
            content_parts.extend(image_parts)

            message = HumanMessage(content=content_parts)
            result = await structured_llm.ainvoke([message])

            logger.info(
                "deep_visual_analysis_complete",
                file=file_name,
                style=result.design_style[:50] if hasattr(result, "design_style") else "unknown",
            )
            return result

        except Exception as e:
            logger.error("deep_visual_analysis_failed", error=str(e), file=file_name)
            return None

    def _merge_themes(self, themes: list[ThemeConfig]) -> ThemeConfig:
        if not themes:
            return ThemeConfig()
        if len(themes) == 1:
            return themes[0]

        color_votes: dict[str, list[str]] = {}
        for theme in themes:
            for key, val in theme.colors.model_dump().items():
                color_votes.setdefault(key, []).append(val)

        merged_colors = {k: max(set(v), key=v.count) for k, v in color_votes.items()}
        heading_fonts = [t.heading_font for t in themes]
        body_fonts = [t.body_font for t in themes]

        from app.models.schemas import ThemeColors, LayoutInfo
        return ThemeConfig(
            colors=ThemeColors(**merged_colors),
            heading_font=max(set(heading_fonts), key=heading_fonts.count),
            body_font=max(set(body_fonts), key=body_fonts.count),
            layouts=[],
            master_background=next((t.master_background for t in themes if t.master_background), None),
        )

    def _build_style_guide(self, analysis: SlideDesignAnalysis, theme: ThemeConfig) -> str:
        colors = theme.colors
        return f"""# Visual Style Guide (from analyzed reference deck)

## Design Language
{analysis.design_style}. Personality: {analysis.brand_personality}.

## Color System
- Background strategy: {analysis.background_strategy}
- Primary background: {analysis.primary_bg_color}
- Primary accent: {analysis.primary_accent_color}
- Secondary accent: {analysis.secondary_accent_color}
- Accent usage: {analysis.accent_usage}
- Color blocking: {analysis.color_blocking}
- Theme colors: accent1={colors.accent1}, accent2={colors.accent2}, dk1={colors.dk1}, lt1={colors.lt1}

## Layout Patterns
{chr(10).join(f"- {p}" for p in analysis.layout_patterns)}

## Content Arrangement
{analysis.content_arrangement}
Information flow: {analysis.information_flow}

## Visual Elements
Shapes: {', '.join(analysis.shapes_used)}
Decorative: {analysis.decorative_elements}

## Typography
- Headings: {analysis.heading_style}
- Body: {analysis.body_style}
- Section labels: {analysis.section_labels}

## Signature Elements (MUST replicate)
{chr(10).join(f"- {s}" for s in analysis.signature_elements)}

## Replication Instructions for pptxgenjs
{analysis.replication_guide}

## Content Density
{analysis.content_density}
"""
