"""StyleResolver — runs once per deck, produces frozen DeckContext.

Precedence chain:
  1. brand template (theme_config from existing extract-theme pipeline)
  2. style profile (themeConfig/visualStyle from StyleProfile table)
  3. content-research fallback (mood classifier + curated catalog)

All non-brand colors are tagged with their source so the UI can later show
"these were auto-picked, change here" hints.
"""

from __future__ import annotations

import structlog

from app.preso_pro.planning.slide_spec import (
    CompositionRules,
    DeckContext,
    PaletteEntry,
    Typography,
    TypographyScale,
)
from app.preso_pro.style.mood_classifier import classify_mood
from app.preso_pro.style.palette_completion import (
    auto_palette,
    complete_palette,
    palette_typography_for_mood,
)

logger = structlog.get_logger()

_VIBRANT = [
    "mesh_gradient_bg", "linear_gradient_bg", "radial_gradient_bg", "dot_field_bg",
    "diagonal_band_bg",
    "accent_blob", "half_circle", "oversized_letter", "oversized_number",
    "gradient_strip", "gradient_title",
    "glass_card", "glass_text_panel", "card_stack", "corner_accent_cluster",
    "stats_row", "quote_callout",
    "bar_chart", "stacked_bar_chart", "line_chart", "area_chart",
    "pie_chart", "donut_chart", "scatter_chart",
    "right_arrow", "star", "hexagon", "chevron", "lightning_bolt",
    "gear", "heart", "shield", "checkmark_badge",
    "arrow_flow", "numbered_steps", "feature_grid", "pyramid_layers",
    "cycle_diagram", "org_chart", "timeline", "vertical_process",
    "radial_list", "swot_quad",
    # Real native SmartArt — preferred over the native composites above
    "smart_art_cycle", "smart_art_org_chart", "smart_art_chevron_rows",
    "smart_art_column_blocks", "smart_art_horizontal_hierarchy",
    "smart_art_hexagon_timeline", "smart_art_chevron_process",
    "smart_art_trapezoid_blocks",
]

_RESTRAINED = [
    "solid_bg", "linear_gradient_bg", "gradient_strip", "dot_field_bg",
    "outlined_card", "solid_card", "card_stack", "corner_accent_cluster",
    "oversized_number",
    "stats_row", "two_column_text", "data_callout",
    "bar_chart", "line_chart", "area_chart",
    "pie_chart", "donut_chart", "scatter_chart",
    "right_arrow", "hexagon", "chevron",
    "shield", "checkmark_badge",
    "arrow_flow", "numbered_steps", "feature_grid", "pyramid_layers",
    "cycle_diagram", "org_chart", "timeline", "vertical_process",
    "radial_list", "swot_quad",
    # Real native SmartArt — preferred over the native composites above
    "smart_art_cycle", "smart_art_org_chart", "smart_art_chevron_rows",
    "smart_art_column_blocks", "smart_art_horizontal_hierarchy",
    "smart_art_hexagon_timeline", "smart_art_chevron_process",
    "smart_art_trapezoid_blocks",
]


DECORATIVES_BY_MOOD = {
    "vibrant-tech":     (_VIBRANT, "high"),
    "vibrant-creative": (_VIBRANT, "high"),
    "startup-energetic": (_VIBRANT, "high"),
    "corporate-trust":  (_RESTRAINED, "low"),
    "fintech-precise":  (_RESTRAINED, "low"),
    "healthcare-calm":  (_RESTRAINED, "medium"),
    "luxury-muted":     (_RESTRAINED, "low"),
    "monochrome-minimal": (_RESTRAINED, "low"),
}


def _seeds_from_theme_config(theme_config: dict | None) -> dict[str, str]:
    """Extract palette seeds from extracted brand theme config."""
    if not theme_config:
        return {}
    colors = theme_config.get("colors") or {}
    seeds: dict[str, str] = {}

    for src_key, role in [
        ("primary", "primary"),
        ("background", "background"),
        ("text", "text_primary"),
        ("accent1", "accent_1"),
        ("accent2", "accent_2"),
    ]:
        val = colors.get(src_key)
        if isinstance(val, str) and val.startswith("#"):
            seeds[role] = val

    return seeds


def _typography_from_theme(theme_config: dict | None) -> dict[str, str]:
    if not theme_config:
        return {}
    out: dict[str, str] = {}
    if isinstance(theme_config.get("heading_font"), str):
        out["heading_font"] = theme_config["heading_font"]
    if isinstance(theme_config.get("body_font"), str):
        out["body_font"] = theme_config["body_font"]
    return out


def _is_dark(palette: dict[str, dict[str, str]]) -> bool:
    bg = palette.get("background", {}).get("hex", "#FFFFFF")
    s = bg.lstrip("#")
    if len(s) != 6:
        return False
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return luminance < 0.5


def resolve_deck_context(
    user_prompt: str,
    audience: str,
    theme_config: dict | None,
    style_guide: str | None = None,
    visual_style: dict | None = None,
) -> DeckContext:
    """Run the precedence chain. Returns frozen DeckContext."""

    mood = classify_mood(user_prompt, audience)

    # 1. brand template seeds
    brand_seeds = _seeds_from_theme_config(theme_config)

    if brand_seeds:
        palette_dict = complete_palette(brand_seeds, mood=mood)
        logger.info("preso_pro_palette_source", source="brand_template", seed_count=len(brand_seeds), mood=mood)
    else:
        # 2. style profile fallback (theme_config can also come from a profile;
        # the worker already merges these so we treat them uniformly above)
        # 3. mood-based catalog
        palette_dict = auto_palette(mood)
        logger.info("preso_pro_palette_source", source="catalog", mood=mood)

    # Typography: brand-extracted fonts first, else mood-catalog defaults
    typo_overrides = _typography_from_theme(theme_config)
    catalog_typo = palette_typography_for_mood(mood)
    typo = Typography(
        heading_font=typo_overrides.get("heading_font") or catalog_typo.get("heading_font", "Inter"),
        body_font=typo_overrides.get("body_font") or catalog_typo.get("body_font", "Inter"),
        scale=TypographyScale(),
    )

    decoratives, density = DECORATIVES_BY_MOOD.get(mood, (["solid_bg", "linear_gradient_bg"], "medium"))
    composition = CompositionRules(
        mood=mood,
        background_mode="dark" if _is_dark(palette_dict) else "light",
        decoratives_allowed=decoratives,
        decoratives_density=density,
        min_negative_space=0.30,
    )

    palette_models = {
        role: PaletteEntry(hex=val["hex"], source=val["source"])
        for role, val in palette_dict.items()
    }

    return DeckContext(
        palette=palette_models,
        typography=typo,
        composition=composition,
        audience=audience,
    )
