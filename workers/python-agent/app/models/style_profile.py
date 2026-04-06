from __future__ import annotations

from pydantic import BaseModel, Field


class VisualStyleAnalysis(BaseModel):
    """Output of multimodal LLM analysis of sampled slide images."""

    design_language: str = Field(
        description="Overall design style: minimal, corporate, creative, academic, startup, etc."
    )
    color_usage: str = Field(
        description="How colors are actually used: accent for headers only, full-bleed backgrounds, subtle gradients, etc."
    )
    content_density: str = Field(
        description="How dense the content is: sparse (few words per slide), moderate, dense (lots of text/data)"
    )
    visual_hierarchy: str = Field(
        description="How information hierarchy is established: size contrast, color contrast, spatial separation, etc."
    )
    spacing_pattern: str = Field(
        description="Spacing approach: generous whitespace, tight/compact, asymmetric, grid-based"
    )
    typography_treatment: str = Field(
        description="How typography is used beyond font names: all-caps headers, sentence case, bold for emphasis, etc."
    )
    graphic_elements: str = Field(
        description="Common visual elements: icons, divider lines, shapes, image treatment, overlays"
    )
    chart_style: str = Field(
        description="If charts present: flat/3D, minimal axes, branded colors, annotation style"
    )
    slide_transitions: str = Field(
        description="Layout transition patterns: consistent headers, alternating layouts, section breaks"
    )
    brand_personality: str = Field(
        description="Overall personality conveyed: professional, playful, authoritative, innovative, etc."
    )


class LayoutPattern(BaseModel):
    """A recurring layout pattern found across source files."""

    layout_type: str  # title, content, two_column, chart, image_focus, section_break
    frequency: float  # 0-1, how often this appears
    description: str  # "Full-bleed image with white text overlay on left third"
    content_density: str  # sparse, moderate, dense
    typical_elements: list[str]  # ["header", "3-4 bullets", "accent bar"]


class StyleProfileData(BaseModel):
    """Complete style profile combining structured + visual analysis."""

    # From XML extraction (structured, exact)
    theme_colors: dict = Field(default_factory=dict)
    heading_font: str = "Calibri"
    body_font: str = "Calibri"
    master_background: str | None = None

    # From multimodal analysis (semantic, descriptive)
    visual_style: VisualStyleAnalysis | None = None
    layout_patterns: list[LayoutPattern] = Field(default_factory=list)

    # Generated style guide (natural language)
    style_guide: str = ""

    # Source metadata
    source_file_count: int = 0
    total_slides_sampled: int = 0


class AnalyzeStyleRequest(BaseModel):
    style_profile_id: str
    source_files: list[SourceFileInfo]
    model_config_dict: dict = Field(default_factory=dict)
    user_id: str = ""


class SourceFileInfo(BaseModel):
    source_id: str
    s3_key: str
    file_name: str


class AnalyzeStyleResponse(BaseModel):
    style_profile_id: str
    status: str
    style_guide: str
    visual_style: VisualStyleAnalysis | None = None
    theme_config: dict | None = None
    layout_patterns: list[dict] | None = None
