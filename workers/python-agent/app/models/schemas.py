from __future__ import annotations

from typing import TypedDict, Annotated
from pydantic import BaseModel, Field
import operator


class ThemeColors(BaseModel):
    dk1: str = "#000000"
    lt1: str = "#FFFFFF"
    dk2: str = "#44546A"
    lt2: str = "#E7E6E6"
    accent1: str = "#4472C4"
    accent2: str = "#ED7D31"
    accent3: str = "#A5A5A5"
    accent4: str = "#FFC000"
    accent5: str = "#5B9BD5"
    accent6: str = "#70AD47"
    hlink: str = "#0563C1"
    folHlink: str = "#954F72"


class PlaceholderInfo(BaseModel):
    idx: int
    type: str
    x: float
    y: float
    w: float
    h: float


class LayoutInfo(BaseModel):
    name: str
    type: str
    placeholders: list[PlaceholderInfo]


class ThemeConfig(BaseModel):
    colors: ThemeColors = Field(default_factory=ThemeColors)
    heading_font: str = "Calibri"
    body_font: str = "Calibri"
    layouts: list[LayoutInfo] = Field(default_factory=list)
    master_background: str | None = None


class ChartData(BaseModel):
    type: str  # bar, line, pie, area
    labels: list[str]
    series: list[dict[str, str | list[float]]]


class SlideSpec(BaseModel):
    slide_number: int
    title: str
    layout: str  # title, content, two_column, chart, image_focus
    body_content: str
    bullet_points: list[str]
    chart_data: ChartData | None = None
    image_query: str | None = None
    speaker_notes: str


class OutlineItem(BaseModel):
    title: str
    layout: str
    key_points: list[str]
    notes: str


class ResearchItem(BaseModel):
    url: str
    content: str
    relevance: float


class LLMConfig(BaseModel):
    provider: str
    model: str
    base_url: str | None = None
    api_key: str | None = None
    temperature: float = 0.7
    max_tokens: int = 4096


class PPTGenerationState(TypedDict, total=False):
    user_prompt: str
    num_slides: int
    audience_type: str
    template_s3_key: str
    reference_file_keys: list[str]
    selected_model: dict
    theme_config: dict
    style_guide: str           # Natural language style guide from StyleProfile
    visual_style: dict         # VisualStyleAnalysis from StyleProfile
    layout_patterns: list[dict]  # Preferred layout patterns from StyleProfile
    research_queries: list[str]
    research_results: Annotated[list[dict], operator.add]
    research_summary: str
    reference_context: str
    outline: list[dict]
    user_approved: bool
    user_edits: list[dict]
    slides: list[dict]
    pptx_s3_key: str
    thumbnail_keys: list[str]
    current_phase: str
    messages: list
    error: str
    job_id: str
    user_id: str


class ExtractThemeRequest(BaseModel):
    s3_key: str


class ExtractThemeResponse(BaseModel):
    theme: ThemeConfig


class ExtractReferenceRequest(BaseModel):
    s3_key: str
    file_type: str


class ExtractReferenceResponse(BaseModel):
    text: str
    structure: list[dict]


class ProgressEvent(BaseModel):
    phase: str
    progress: float
    message: str
    data: dict | None = None
