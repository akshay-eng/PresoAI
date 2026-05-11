"""Palette completion — given seed brand colors, fill the rest from the catalog.

Strategy: rather than generating mathematical harmonics directly (which produces
muddy results), we snap to the closest catalog palette (HSL distance on primary)
and substitute the user's actual brand colors back in for the roles they
provided. The non-brand roles inherit from the catalog palette.
"""

from __future__ import annotations

import colorsys
import json
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).parent / "palette_catalog.json"


def _hex_to_hsl(hex_str: str) -> tuple[float, float, float]:
    s = hex_str.lstrip("#")
    if len(s) != 6:
        return (0.0, 0.0, 0.0)
    r = int(s[0:2], 16) / 255.0
    g = int(s[2:4], 16) / 255.0
    b = int(s[4:6], 16) / 255.0
    h, l, sat = colorsys.rgb_to_hls(r, g, b)
    return (h, sat, l)


def _hsl_distance(a_hex: str, b_hex: str) -> float:
    h1, s1, l1 = _hex_to_hsl(a_hex)
    h2, s2, l2 = _hex_to_hsl(b_hex)
    # circular hue distance
    dh = min(abs(h1 - h2), 1.0 - abs(h1 - h2)) * 2.0
    return (dh ** 2 + (s1 - s2) ** 2 + (l1 - l2) ** 2) ** 0.5


def _load_catalog() -> list[dict[str, Any]]:
    return json.loads(CATALOG_PATH.read_text())


def _filter_catalog(
    catalog: list[dict[str, Any]],
    mood: str | None = None,
    background_mode: str | None = None,
) -> list[dict[str, Any]]:
    out = catalog
    if mood:
        out = [c for c in out if c["mood"] == mood]
    if background_mode:
        out = [c for c in out if c["background_mode"] == background_mode]
    return out or catalog


def _is_dark(hex_str: str) -> bool:
    _, _, l = _hex_to_hsl(hex_str)
    return l < 0.5


def pick_catalog_palette(
    mood: str,
    seed_primary: str | None = None,
    background_mode: str | None = None,
) -> dict[str, Any]:
    """Return the closest catalog entry for the given mood/seed."""
    catalog = _load_catalog()
    candidates = _filter_catalog(catalog, mood=mood, background_mode=background_mode)

    if not seed_primary:
        return candidates[0]

    return min(
        candidates,
        key=lambda c: _hsl_distance(seed_primary, c["palette"]["primary"]),
    )


def complete_palette(
    seeds: dict[str, str],
    mood: str = "vibrant-tech",
) -> dict[str, dict[str, str]]:
    """Build a complete 8-role palette from sparse brand seeds.

    seeds: dict like {"primary": "#7B2CBF", "surface": "#FAFAFA"}
           keys are PaletteRole names; values are hex strings.

    Returns: dict[role -> {"hex", "source"}] for all 8 roles. Brand-provided
    roles keep their hex with source="brand"; missing roles come from a
    catalog palette and are tagged source="augmented".
    """
    seed_primary = seeds.get("primary")
    bg_mode = None
    if seeds.get("background"):
        bg_mode = "dark" if _is_dark(seeds["background"]) else "light"

    catalog_pick = pick_catalog_palette(mood, seed_primary=seed_primary, background_mode=bg_mode)
    catalog_palette = catalog_pick["palette"]

    out: dict[str, dict[str, str]] = {}
    for role, default_hex in catalog_palette.items():
        if role in seeds and seeds[role]:
            out[role] = {"hex": seeds[role], "source": "brand"}
        else:
            out[role] = {"hex": default_hex, "source": "augmented"}
    return out


def auto_palette(mood: str) -> dict[str, dict[str, str]]:
    """Pick a full palette from the catalog for a given mood (no brand input)."""
    catalog_pick = pick_catalog_palette(mood)
    return {
        role: {"hex": hex_str, "source": "auto"}
        for role, hex_str in catalog_pick["palette"].items()
    }


def palette_typography_for_mood(mood: str) -> dict[str, str]:
    """Pick the typography pair from the catalog entry for the given mood."""
    catalog_pick = pick_catalog_palette(mood)
    return catalog_pick.get("typography", {"heading_font": "Inter", "body_font": "Inter"})
