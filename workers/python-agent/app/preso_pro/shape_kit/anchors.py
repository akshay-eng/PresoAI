"""Anchor system — converts named anchors to (x, y) EMU offsets on a 16:9 slide.

The Composer LLM only emits anchor names. The executor resolves to absolute
positions based on the slide size, allowing aspect-ratio changes without
breaking specs.
"""

from __future__ import annotations

# Standard 16:9 PPTX slide size in EMUs (English Metric Units).
SLIDE_WIDTH_EMU = 12192000   # 13.333"
SLIDE_HEIGHT_EMU = 6858000   # 7.5"

# Each anchor is (x_fraction, y_fraction) where 0,0 = top-left, 1,1 = bottom-right.
ANCHOR_TABLE: dict[str, tuple[float, float]] = {
    "upper-left":          (0.10, 0.12),
    "upper-center":        (0.50, 0.12),
    "upper-right":         (0.90, 0.12),
    "center-left":         (0.10, 0.50),
    "center":              (0.50, 0.50),
    "center-right":        (0.90, 0.50),
    "lower-left":          (0.10, 0.85),
    "lower-center":        (0.50, 0.85),
    "lower-right":         (0.90, 0.85),
    "diagonal-thirds-A":   (0.33, 0.33),
    "diagonal-thirds-B":   (0.67, 0.67),
}


def anchor_to_emu(
    anchor: str,
    slide_w: int = SLIDE_WIDTH_EMU,
    slide_h: int = SLIDE_HEIGHT_EMU,
) -> tuple[int, int]:
    fx, fy = ANCHOR_TABLE.get(anchor, ANCHOR_TABLE["center"])
    return (int(fx * slide_w), int(fy * slide_h))


def fraction_to_emu(
    fx: float,
    fy: float,
    slide_w: int = SLIDE_WIDTH_EMU,
    slide_h: int = SLIDE_HEIGHT_EMU,
) -> tuple[int, int]:
    return (int(fx * slide_w), int(fy * slide_h))
