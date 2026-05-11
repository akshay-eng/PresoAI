"""Shape kit registry — the universe of functions the Composer can call."""

from __future__ import annotations

from typing import Any, Callable

from app.preso_pro.shape_kit import helpers
from app.preso_pro.shape_kit import charts
from app.preso_pro.shape_kit import complex_shapes
from app.preso_pro import smart_art


REGISTRY: dict[str, Callable[..., Any]] = {
    # Backgrounds
    "solid_bg": helpers.solid_bg,
    "linear_gradient_bg": helpers.linear_gradient_bg,
    "radial_gradient_bg": helpers.radial_gradient_bg,
    "mesh_gradient_bg": helpers.mesh_gradient_bg,
    "dot_field_bg": helpers.dot_field_bg,
    "diagonal_band_bg": helpers.diagonal_band_bg,
    # Decoratives
    "accent_blob": helpers.accent_blob,
    "half_circle": helpers.half_circle,
    "gradient_strip": helpers.gradient_strip,
    "oversized_letter": helpers.oversized_letter,
    "oversized_number": helpers.oversized_number,
    # Cards
    "solid_card": helpers.solid_card,
    "glass_card": helpers.glass_card,
    "outlined_card": helpers.outlined_card,
    "card_stack": helpers.card_stack,
    "glass_text_panel": helpers.glass_text_panel,
    "corner_accent_cluster": helpers.corner_accent_cluster,
    # Typography
    "title_text": helpers.title_text,
    "body_text": helpers.body_text,
    "gradient_title": helpers.gradient_title,
    "bullet_list": helpers.bullet_list,
    # Composites
    "data_callout": helpers.data_callout,
    "stats_row": helpers.stats_row,
    "quote_callout": helpers.quote_callout,
    "two_column_text": helpers.two_column_text,
    # Charts
    "bar_chart": charts.bar_chart,
    "stacked_bar_chart": charts.stacked_bar_chart,
    "line_chart": charts.line_chart,
    "area_chart": charts.area_chart,
    "scatter_chart": charts.scatter_chart,
    "pie_chart": charts.pie_chart,
    "donut_chart": charts.donut_chart,
    # Complex shapes + flow composites
    "right_arrow": complex_shapes.right_arrow,
    "star": complex_shapes.star,
    "hexagon": complex_shapes.hexagon,
    "chevron": complex_shapes.chevron,
    "lightning_bolt": complex_shapes.lightning_bolt,
    "gear": complex_shapes.gear,
    "heart": complex_shapes.heart,
    "shield": complex_shapes.shield,
    "checkmark_badge": complex_shapes.checkmark_badge,
    "arrow_flow": complex_shapes.arrow_flow,
    "numbered_steps": complex_shapes.numbered_steps,
    "feature_grid": complex_shapes.feature_grid,
    "pyramid_layers": complex_shapes.pyramid_layers,
    # SmartArt-equivalent native composites (fallback if real SmartArt fails)
    "cycle_diagram": complex_shapes.cycle_diagram,
    "org_chart": complex_shapes.org_chart,
    "timeline": complex_shapes.timeline,
    "vertical_process": complex_shapes.vertical_process,
    "radial_list": complex_shapes.radial_list,
    "swot_quad": complex_shapes.swot_quad,
    # ── REAL native PowerPoint SmartArt (preferred over native composites) ──
    "smart_art_cycle":                smart_art.smart_art_cycle,
    "smart_art_org_chart":            smart_art.smart_art_org_chart,
    "smart_art_chevron_rows":         smart_art.smart_art_chevron_rows,
    "smart_art_column_blocks":        smart_art.smart_art_column_blocks,
    "smart_art_horizontal_hierarchy": smart_art.smart_art_horizontal_hierarchy,
    "smart_art_hexagon_timeline":     smart_art.smart_art_hexagon_timeline,
    "smart_art_chevron_process":      smart_art.smart_art_chevron_process,
    "smart_art_trapezoid_blocks":     smart_art.smart_art_trapezoid_blocks,
}


SIGNATURES: dict[str, dict[str, Any]] = {
    "solid_bg": {
        "purpose": "Fill the entire slide background with one palette role color.",
        "args": {"role": "PaletteRole — usually 'background' or 'surface'"},
    },
    "linear_gradient_bg": {
        "purpose": "Two-stop diagonal/horizontal/vertical gradient covering the slide.",
        "args": {"role_a": "PaletteRole", "role_b": "PaletteRole", "angle": "int 0-360"},
    },
    "radial_gradient_bg": {
        "purpose": "Radial gradient — soft glow from a focus point fading outward.",
        "args": {
            "role_inner": "PaletteRole", "role_outer": "PaletteRole",
            "focus": "string ('center'|'upper-left'|'upper-right'|'lower-left'|'lower-right')",
        },
    },
    "mesh_gradient_bg": {
        "purpose": "Modern marketing-style mesh gradient — base color with overlapping translucent corner blobs of accent colors. High visual impact.",
        "args": {"roles": "list of PaletteRoles (3-4)", "blob_count": "int 2-4"},
    },
    "dot_field_bg": {
        "purpose": "Solid background with a subtle grid of small dots in an accent color.",
        "args": {"role_bg": "PaletteRole", "role_dot": "PaletteRole", "density": "int 6-12"},
    },
    "diagonal_band_bg": {
        "purpose": "Solid background with a translucent diagonal stripe across the middle.",
        "args": {"role_bg": "PaletteRole", "role_band": "PaletteRole"},
    },
    "accent_blob": {
        "purpose": "Decorative round accent shape (oval) with optional transparency.",
        "args": {"position": "Anchor", "size": "int 50-500 (pt)",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "half_circle": {
        "purpose": "A half-circle / arc-segment decorative.",
        "args": {"position": "Anchor", "size": "int 100-400",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "gradient_strip": {
        "purpose": "A thin gradient stripe along an edge of the slide. Brand-bar accent.",
        "args": {"role_a": "PaletteRole", "role_b": "PaletteRole",
                 "edge": "string ('left'|'right'|'top'|'bottom')",
                 "thickness": "int 30-100"},
    },
    "oversized_letter": {
        "purpose": "Decorative giant letter used in a corner with low opacity.",
        "args": {"text": "string (1-3 chars)", "anchor": "Anchor",
                 "role": "PaletteRole", "opacity": "float 0.05-0.30",
                 "size": "int 300-700"},
    },
    "oversized_number": {
        "purpose": "Decorative giant number/short string for visual texture (use for numbers).",
        "args": {"text": "string (1-4 chars — '01', 'Q3', '47%')",
                 "anchor": "Anchor", "role": "PaletteRole",
                 "opacity": "float 0.08-0.30", "size": "int 280-450"},
    },
    "solid_card": {
        "purpose": "Solid rounded rectangle card. Pair with title_text/body_text on top.",
        "args": {"anchor": "Anchor", "width_frac": "float 0.2-0.9",
                 "height_frac": "float 0.2-0.8", "role": "PaletteRole"},
    },
    "glass_card": {
        "purpose": "Translucent card with subtle accent border. Modern glass-morphism look.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "role": "PaletteRole", "border_role": "PaletteRole",
                 "opacity": "float 0.15-0.50"},
    },
    "outlined_card": {
        "purpose": "Outlined-only rounded rectangle card.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "border_role": "PaletteRole"},
    },
    "card_stack": {
        "purpose": "Layered offset rounded cards (depth effect). Backdrop only — pair with text on top at the same anchor.",
        "args": {"anchor": "Anchor", "width_frac": "float 0.4-0.7",
                 "height_frac": "float 0.3-0.6", "role": "PaletteRole",
                 "accent_role": "PaletteRole", "count": "int 2-3"},
    },
    "glass_text_panel": {
        "purpose": "Translucent panel WITH text inside. Self-contained — no separate title needed.",
        "args": {"text": "string", "anchor": "Anchor", "tier": "TypographyTier",
                 "role_text": "PaletteRole", "role_panel": "PaletteRole",
                 "role_border": "PaletteRole", "width_frac": "float 0.3-0.7"},
    },
    "corner_accent_cluster": {
        "purpose": "Small grouped shapes at a corner. Adds energy without dominating.",
        "args": {"corner": "string corner",
                 "role": "PaletteRole", "secondary_role": "PaletteRole",
                 "scale": "float 0.6-1.4"},
    },
    "title_text": {
        "purpose": "Render a heading at an anchor.",
        "args": {"text": "string", "anchor": "Anchor", "tier": "TypographyTier",
                 "role": "PaletteRole", "weight": "int 400-900",
                 "width_frac": "float 0.3-0.9"},
    },
    "body_text": {
        "purpose": "Render regular body paragraph text.",
        "args": {"text": "string", "anchor": "Anchor", "tier": "TypographyTier",
                 "role": "PaletteRole", "width_frac": "float 0.3-0.9"},
    },
    "gradient_title": {
        "purpose": "Visually striking title with gradient text fill.",
        "args": {"text": "string", "anchor": "Anchor", "tier": "TypographyTier",
                 "role_a": "PaletteRole", "role_b": "PaletteRole",
                 "weight": "int 400-900", "width_frac": "float"},
    },
    "bullet_list": {
        "purpose": "Simple bulleted list of short items.",
        "args": {"items": "list of strings (3-7)", "anchor": "Anchor",
                 "tier": "TypographyTier", "role": "PaletteRole",
                 "width_frac": "float 0.3-0.7"},
    },
    "data_callout": {
        "purpose": "Big number + small label pattern.",
        "args": {"position": "Anchor", "value": "string", "label": "string",
                 "role": "PaletteRole"},
    },
    "stats_row": {
        "purpose": "Horizontal row of 2-5 stat tiles with big numbers and labels.",
        "args": {"items": "list of {value, label} dicts (2-5)",
                 "anchor": "Anchor", "role": "PaletteRole"},
    },
    "quote_callout": {
        "purpose": "Pull-quote pattern: large italic quote with attribution.",
        "args": {"text": "string", "attribution": "string",
                 "anchor": "Anchor", "role_quote": "PaletteRole", "role_accent": "PaletteRole"},
    },
    "two_column_text": {
        "purpose": "Two-column comparison or feature layout.",
        "args": {"left_title": "string", "left_body": "string",
                 "right_title": "string", "right_body": "string",
                 "anchor": "Anchor",
                 "role_title": "PaletteRole", "role_body": "PaletteRole"},
    },
    # ── Charts ──
    "bar_chart": {
        "purpose": "Native PowerPoint bar chart. Vertical or horizontal bars with multiple series.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "series": "list of {name, values:list[number]}",
                 "orientation": "string ('vertical'|'horizontal')",
                 "role_a": "PaletteRole", "role_b": "PaletteRole"},
    },
    "stacked_bar_chart": {
        "purpose": "Stacked bar chart — segments per bar.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "series": "list of {name, values}"},
    },
    "line_chart": {
        "purpose": "Native line chart. Use for trends over time (MRR, growth, etc.).",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "series": "list of {name, values}"},
    },
    "area_chart": {
        "purpose": "Filled area chart. Like line chart but with the area below shaded.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "series": "list of {name, values}"},
    },
    "pie_chart": {
        "purpose": "Native pie chart. Use for share-of breakdowns.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "values": "list[number]"},
    },
    "donut_chart": {
        "purpose": "Native donut chart.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string", "categories": "list[string]",
                 "values": "list[number]"},
    },
    # ── Complex shapes ──
    "right_arrow": {
        "purpose": "Single arrow shape pointing right/left/up/down.",
        "args": {"anchor": "Anchor", "length": "int 80-400 (pt)",
                 "height": "int 30-120", "role": "PaletteRole",
                 "opacity": "float 0.0-1.0",
                 "direction": "string ('right'|'left'|'up'|'down')"},
    },
    "star": {
        "purpose": "A star — 4/5/6/7/8/10 points. Use for ratings, badges, accents.",
        "args": {"anchor": "Anchor", "size": "int 40-200 (pt)",
                 "points": "int (4|5|6|7|8|10)",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "hexagon": {
        "purpose": "A regular hexagon. Modern tech/B2B accent.",
        "args": {"anchor": "Anchor", "size": "int 60-300",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "chevron": {
        "purpose": "A chevron arrow — used inside flows for connection.",
        "args": {"anchor": "Anchor", "length": "int 60-300", "height": "int 30-120",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "lightning_bolt": {
        "purpose": "Lightning-bolt shape. Energy/speed accent.",
        "args": {"anchor": "Anchor", "size": "int 60-200",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "arrow_flow": {
        "purpose": "A horizontal sequence of arrows with text on each — process flow visual. 3-5 steps. ALWAYS use this for 'how it works' / 'process' / 'workflow' content.",
        "args": {"steps": "list of short strings (3-5, each <=20 chars)",
                 "anchor": "Anchor",
                 "role_arrow": "PaletteRole", "role_text": "PaletteRole"},
    },
    "numbered_steps": {
        "purpose": "Numbered circles with labels and connecting chevrons. 3-6 steps. Premium look for product walkthroughs.",
        "args": {"items": "list of {label} dicts (3-6)",
                 "anchor": "Anchor",
                 "role_circle": "PaletteRole", "role_label": "PaletteRole"},
    },
    "pyramid_layers": {
        "purpose": "Stacked pyramid of trapezoids with labels — hierarchy/tiers visual.",
        "args": {"items": "list of strings (top to bottom, 3-5)",
                 "anchor": "Anchor",
                 "role_top": "PaletteRole", "role_base": "PaletteRole",
                 "role_text": "PaletteRole"},
    },
    "feature_grid": {
        "purpose": "Marketing core-features layout: 3-4 cards each with icon + title + body. Use this for 'features', 'capabilities', 'what we offer' content. WAY better than bullet_list for this.",
        "args": {"items": "list of {icon: 1-3 char glyph, title: string, body: string} dicts (3-4)",
                 "anchor": "Anchor",
                 "role_card": "PaletteRole", "role_icon": "PaletteRole",
                 "role_title": "PaletteRole", "role_body": "PaletteRole"},
    },
    "scatter_chart": {
        "purpose": "Native XY scatter chart — distribution / correlation visualization.",
        "args": {"anchor": "Anchor", "width_frac": "float", "height_frac": "float",
                 "title": "string",
                 "series": "list of {name, points: [[x,y], ...]}"},
    },
    "gear": {
        "purpose": "9-tooth gear/cog icon. Use for 'how it works', 'engine', 'configuration'.",
        "args": {"anchor": "Anchor", "size": "int 60-200",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "heart": {
        "purpose": "Heart shape. Use for 'love', 'community', 'customer love' slides.",
        "args": {"anchor": "Anchor", "size": "int 60-200",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "shield": {
        "purpose": "Shield/pentagon shape. Use for security, trust, compliance content.",
        "args": {"anchor": "Anchor", "size": "int 60-200",
                 "role": "PaletteRole", "opacity": "float 0.0-1.0"},
    },
    "checkmark_badge": {
        "purpose": "Circle with checkmark inside — affirmation accent. Place near a benefit you want to emphasize.",
        "args": {"anchor": "Anchor", "size": "int 50-150",
                 "role_circle": "PaletteRole", "role_check": "PaletteRole"},
    },
    # ── SmartArt-equivalent composites ──
    "cycle_diagram": {
        "purpose": "Cyclical / loop process — N nodes (3-6) arranged in a circle with arrows between each pair. Use for recurring/iterative processes (build-measure-learn, OODA, lifecycle). Self-contained — no extra title needed at center.",
        "args": {"items": "list of short strings (3-6, each <=18 chars)",
                 "anchor": "Anchor (center recommended)",
                 "role_node": "PaletteRole", "role_arrow": "PaletteRole",
                 "role_text": "PaletteRole"},
    },
    "org_chart": {
        "purpose": "Hierarchy diagram — one root box on top, N children (2-5) underneath, connected by lines. Use for team structure, taxonomy, parent-child relationships.",
        "args": {"root": "string (root label)",
                 "children": "list of strings (2-5)",
                 "anchor": "Anchor (center recommended)",
                 "role_root": "PaletteRole", "role_child": "PaletteRole",
                 "role_root_text": "PaletteRole", "role_child_text": "PaletteRole",
                 "role_line": "PaletteRole"},
    },
    "timeline": {
        "purpose": "Horizontal timeline with date markers. Use for milestones, roadmaps, history, event sequences. Items 3-6, each with date + label.",
        "args": {"items": "list of {date, label} dicts (3-6)",
                 "anchor": "Anchor (center recommended)",
                 "role_line": "PaletteRole", "role_marker": "PaletteRole",
                 "role_text": "PaletteRole", "role_date": "PaletteRole"},
    },
    "vertical_process": {
        "purpose": "Vertically stacked steps with downward arrows between them. Use when steps need more vertical breathing room than horizontal numbered_steps allows. 2-5 steps.",
        "args": {"items": "list of strings (2-5)",
                 "anchor": "Anchor (center recommended)",
                 "role_box": "PaletteRole", "role_arrow": "PaletteRole",
                 "role_text": "PaletteRole"},
    },
    "radial_list": {
        "purpose": "Center hub with N radiating items connected by lines. Use for 'core pillars', 'around the X', or hub-and-spoke relationships. 3-6 satellite items.",
        "args": {"hub": "string (center label)",
                 "items": "list of strings (3-6)",
                 "anchor": "Anchor (center recommended)",
                 "role_hub": "PaletteRole", "role_node": "PaletteRole",
                 "role_hub_text": "PaletteRole", "role_node_text": "PaletteRole",
                 "role_line": "PaletteRole"},
    },
    "swot_quad": {
        "purpose": "2x2 matrix layout with header strip per quadrant and bullet items below. Use for SWOT, BCG matrix, comparison frameworks, any 4-category breakdown. Self-contained — no title needed (each quadrant has its own header).",
        "args": {"quadrants": "list of EXACTLY 4 {label, items} dicts in order [top-left, top-right, bottom-left, bottom-right]; items is list of 2-4 short strings",
                 "anchor": "Anchor (center recommended)",
                 "role_a": "PaletteRole (top-left header)",
                 "role_b": "PaletteRole (top-right header)",
                 "role_c": "PaletteRole (bottom-left header)",
                 "role_d": "PaletteRole (bottom-right header)",
                 "role_header_text": "PaletteRole", "role_body_text": "PaletteRole"},
    },
    # ── REAL native PowerPoint SmartArt — STRONGLY PREFERRED over the native composites above ──
    # These render as real SmartArt that PowerPoint treats as restylable / editable
    # via its SmartArt Design ribbon. Visually richer, cleaner, more professional.
    "smart_art_cycle": {
        "purpose": "Real native PowerPoint Continuous Cycle SmartArt — 5 rounded boxes arranged around a circle with arc arrows. Use INSTEAD of cycle_diagram for any iterative/loop content (build-measure-learn, OODA, retention loop, plan-do-check-act). Self-contained — do NOT add a separate title at center.",
        "args": {"items": "list of EXACTLY 5 short strings (each <=18 chars)",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.6-0.85"},
    },
    "smart_art_org_chart": {
        "purpose": "Real native PowerPoint Organization Chart SmartArt — root box on top, 3 children below, connected by lines. Use INSTEAD of org_chart for team structure, taxonomy, parent-child hierarchies.",
        "args": {"items": "list of EXACTLY 4 strings — [root_label, child1, child2, child3]",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.7-0.9"},
    },
    "smart_art_chevron_rows": {
        "purpose": "Real native SmartArt — 3 rows of 3 chevron arrows each. Use for parallel/multi-stream processes ('three workstreams', 'three teams each with three steps'). Each row's first chevron is the accent color.",
        "args": {"items": "list of EXACTLY 9 short strings — row1step1, row1step2, row1step3, row2step1, ..., row3step3",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.7-0.9"},
    },
    "smart_art_column_blocks": {
        "purpose": "Real native SmartArt — 3 column backgrounds, each with a column title and 2 stacked dark-blue cells underneath. Use for 'three pillars', 'three principles', 'three tiers'. PROFESSIONAL marketing-deck visual quality.",
        "args": {"items": "list of EXACTLY 9 strings — col1_title, col1_item1, col1_item2, col2_title, col2_item1, col2_item2, col3_title, col3_item1, col3_item2",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.7-0.85"},
    },
    "smart_art_horizontal_hierarchy": {
        "purpose": "Real native SmartArt — horizontal hierarchy with 3 column backgrounds, root → mid-tier → leaves connected by lines. Use INSTEAD of org_chart for richer hierarchical structures.",
        "args": {"items": "list of UP TO 9 strings (root + 2 mid-tier + leaves; pad with empty strings if fewer)",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.7-0.9"},
    },
    "smart_art_hexagon_timeline": {
        "purpose": "Real native SmartArt — modern Hexagon Timeline with 3 milestones, each with a date/title above and a description below. Use INSTEAD of timeline for milestones/roadmap/journey content.",
        "args": {"items": "list of EXACTLY 6 strings as alternating pairs — date1, label1, date2, label2, date3, label3",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.75-0.9"},
    },
    "smart_art_chevron_process": {
        "purpose": "Real native SmartArt — modern Accent Chevron Process with 3 chevrons each carrying a title + caption. Use INSTEAD of arrow_flow/numbered_steps/vertical_process for any 'how it works' / 'engagement flow' / 'process' content. Premium marketing aesthetic.",
        "args": {"items": "list of EXACTLY 6 strings as alternating pairs — title1, caption1, title2, caption2, title3, caption3",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.75-0.9"},
    },
    "smart_art_trapezoid_blocks": {
        "purpose": "Real native SmartArt — 3 large blue trapezoid blocks side-by-side, each with a bold title + 2 bullet items. BANGER visual for 'three core values', 'three pillars', 'three commitments'. Self-contained — do NOT add a separate title.",
        "args": {"items": "list of EXACTLY 9 strings — block1_title, block1_bullet1, block1_bullet2, block2_title, block2_bullet1, block2_bullet2, block3_title, block3_bullet1, block3_bullet2",
                 "anchor": "Anchor (center recommended)",
                 "size_frac": "float 0.55-0.75"},
    },
}


def is_registered(fn_name: str) -> bool:
    return fn_name in REGISTRY


def get_function(fn_name: str) -> Callable[..., Any] | None:
    return REGISTRY.get(fn_name)


def signatures_filtered(allowed: list[str] | None = None) -> dict[str, dict[str, Any]]:
    if not allowed:
        return SIGNATURES
    return {name: sig for name, sig in SIGNATURES.items() if name in allowed}


__all__ = ["REGISTRY", "SIGNATURES", "is_registered", "get_function", "signatures_filtered"]
