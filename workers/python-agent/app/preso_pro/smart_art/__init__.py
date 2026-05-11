"""Real native PowerPoint SmartArt for Preso Pro.

Templates are extracted from a hand-curated reference PowerPoint and stored
under templates/. At slide-build time we substitute placeholder text with the
LLM's items, drop a marker on the slide, and the orchestrator's post-processor
injects the diagram parts + graphicFrame after python-pptx saves.

Layouts in this build (chosen for visual richness — modern marketing aesthetic):
  smart_art_cycle                  Continuous Cycle (cycle3)
  smart_art_org_chart              Organization Chart (orgChart1)
  smart_art_chevron_rows           3-row chevron process (lProcess3)
  smart_art_column_blocks          3-column stacked cells (lProcess2)
  smart_art_horizontal_hierarchy   3-column hierarchy with backgrounds (hierarchy5)
  smart_art_hexagon_timeline       Hexagon Timeline (HexagonTimeline)
  smart_art_chevron_process        Accent Chevron Process (AccentHomeChevronProcess)
  smart_art_trapezoid_blocks       3 trapezoid blocks (hList6)
"""

from app.preso_pro.smart_art.shape_kit_fns import (
    smart_art_chevron_process,
    smart_art_chevron_rows,
    smart_art_column_blocks,
    smart_art_cycle,
    smart_art_hexagon_timeline,
    smart_art_horizontal_hierarchy,
    smart_art_org_chart,
    smart_art_trapezoid_blocks,
)
from app.preso_pro.smart_art.package_helpers import inject_smart_arts, PendingSmartArt
from app.preso_pro.smart_art.builder import SmartArtBuilder, SUPPORTED_LAYOUTS

__all__ = [
    "smart_art_cycle",
    "smart_art_org_chart",
    "smart_art_chevron_rows",
    "smart_art_column_blocks",
    "smart_art_horizontal_hierarchy",
    "smart_art_hexagon_timeline",
    "smart_art_chevron_process",
    "smart_art_trapezoid_blocks",
    "inject_smart_arts",
    "PendingSmartArt",
    "SmartArtBuilder",
    "SUPPORTED_LAYOUTS",
]
