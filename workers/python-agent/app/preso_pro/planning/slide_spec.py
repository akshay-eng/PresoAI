"""Slide spec — the JSON contract between Composer, Validator, and Executor.

Strict schema. No raw hex anywhere except inside the deck-level palette.
The Composer's only job is to emit JSON matching this shape; the Executor's
only job is to consume it and emit native PPTX.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


PaletteRole = Literal[
    "background",
    "surface",
    "primary",
    "accent_1",
    "accent_2",
    "text_primary",
    "text_muted",
    "text_inverse",
]

TypographyTier = Literal["display", "h1", "h2", "body", "caption"]

Anchor = Literal[
    "upper-left", "upper-center", "upper-right",
    "center-left", "center", "center-right",
    "lower-left", "lower-center", "lower-right",
    "diagonal-thirds-A", "diagonal-thirds-B",
]


class ShapeCall(BaseModel):
    """One shape-kit function call to make on a slide.

    `fn` must be a registered shape-kit function name. `args` is validated
    per-function at execution time. Colors must always be palette-role refs;
    fonts always tier names — never raw values.
    """

    fn: str
    args: dict[str, Any] = Field(default_factory=dict)


class SlideSpec(BaseModel):
    """The full description of one slide in deck."""

    slide_index: int
    intent: str  # tag from planner: "stats-row", "hero", "quote", etc.
    background: ShapeCall | None = None
    elements: list[ShapeCall] = Field(default_factory=list)


class PaletteEntry(BaseModel):
    hex: str
    source: Literal["brand", "profile", "auto", "augmented"]


class TypographyScale(BaseModel):
    display: int = 96
    h1: int = 64
    h2: int = 40
    body: int = 18
    caption: int = 12


class Typography(BaseModel):
    heading_font: str = "Inter"
    body_font: str = "Inter"
    scale: TypographyScale = Field(default_factory=TypographyScale)


class CompositionRules(BaseModel):
    mood: str
    background_mode: Literal["dark", "light"] = "dark"
    decoratives_allowed: list[str] = Field(default_factory=list)
    decoratives_density: Literal["low", "medium", "high"] = "medium"
    min_negative_space: float = 0.30


class DeckContext(BaseModel):
    """Frozen at deck creation. Every slide inherits this verbatim."""

    palette: dict[PaletteRole, PaletteEntry]
    typography: Typography = Field(default_factory=Typography)
    composition: CompositionRules
    audience: str = "marketing"
