"""Shared helpers for shape-kit functions."""

from __future__ import annotations

from app.preso_pro.planning.slide_spec import DeckContext, PaletteRole, TypographyTier


def hex_for_role(ctx: DeckContext, role: str) -> str:
    """Resolve a palette role to its hex string. Falls back to text_primary."""
    palette = ctx.palette
    if role in palette:
        return palette[role].hex  # type: ignore[index]
    if "text_primary" in palette:
        return palette["text_primary"].hex  # type: ignore[index]
    return "#FFFFFF"


def font_for_kind(ctx: DeckContext, kind: str = "heading") -> str:
    return ctx.typography.heading_font if kind == "heading" else ctx.typography.body_font


def size_for_tier(ctx: DeckContext, tier: str) -> int:
    scale = ctx.typography.scale
    return getattr(scale, tier, scale.body)


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    s = hex_str.lstrip("#")
    if len(s) != 6:
        return (255, 255, 255)
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
