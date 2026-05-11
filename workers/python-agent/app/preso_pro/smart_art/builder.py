"""SmartArtBuilder — high-level façade.

Loads template assets for a given layout, populates data1.xml with the user's
items, returns a PendingSmartArt record that the post-processor will inject
into the saved .pptx.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from app.preso_pro.smart_art.data_emitter import emit_data_xml, template_slot_count
from app.preso_pro.smart_art.package_helpers import PendingSmartArt

TEMPLATES_ROOT = Path(__file__).parent / "templates"

SUPPORTED_LAYOUTS = (
    "cycle3",                    # Continuous Cycle (boxes with arc arrows)
    "orgChart1",                 # Organization Chart
    "lProcess3",                 # 3 rows of chevron arrows
    "lProcess2",                 # 3 columns of stacked cells
    "hierarchy5",                # Horizontal hierarchy (3 columns w/ background)
    "HexagonTimeline",           # Modern hexagon timeline
    "AccentHomeChevronProcess",  # Modern chevron process
    "hList6",                    # 3 trapezoid blocks side-by-side
)


@dataclass
class SmartArtRequest:
    layout_key: str
    items: list[str]
    slide_index: int           # 1-based
    x_emu: int
    y_emu: int
    cx_emu: int
    cy_emu: int


class SmartArtBuilder:
    def __init__(self, layout_key: str):
        if layout_key not in SUPPORTED_LAYOUTS:
            raise ValueError(
                f"Unknown SmartArt layout {layout_key!r}. "
                f"Supported: {SUPPORTED_LAYOUTS}"
            )
        self.layout_key = layout_key
        self.dir = TEMPLATES_ROOT / layout_key

    def slot_count(self) -> int:
        """How many data nodes the template ships with (v1 fixed-count limit)."""
        return template_slot_count(self.dir / "data_template.xml")

    def build(self, req: SmartArtRequest, marker_id: str) -> PendingSmartArt:
        data_xml = emit_data_xml(self.dir / "data_template.xml", req.items)
        layout_xml = (self.dir / "layout.xml").read_bytes()
        colors_xml = (self.dir / "colors.xml").read_bytes()
        qs_xml = (self.dir / "quickStyle.xml").read_bytes()

        return PendingSmartArt(
            slide_index=req.slide_index,
            layout_key=self.layout_key,
            marker_id=marker_id,
            data_xml=data_xml,
            layout_xml=layout_xml,
            colors_xml=colors_xml,
            quick_style_xml=qs_xml,
            x_emu=req.x_emu,
            y_emu=req.y_emu,
            cx_emu=req.cx_emu,
            cy_emu=req.cy_emu,
        )


def new_marker_id() -> str:
    """Unique marker so we can find this exact SmartArt request later."""
    return uuid.uuid4().hex[:12]
