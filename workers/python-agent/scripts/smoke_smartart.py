"""Smoke test for the 6 SmartArt-style composites.

Builds one slide per composite using a fixed DeckContext + manual specs (no LLM
involvement). Validates that each composite renders without error and produces
a viewable PPTX.

Run from repo root:
    cd workers/python-agent && .venv/bin/python scripts/smoke_smartart.py
Output: /tmp/smoke_smartart.pptx
"""

from __future__ import annotations

from app.preso_pro.executor import execute_slide, new_presentation
from app.preso_pro.planning.slide_spec import (
    CompositionRules,
    DeckContext,
    PaletteEntry,
    ShapeCall,
    SlideSpec,
    Typography,
    TypographyScale,
)


def make_ctx() -> DeckContext:
    palette = {
        "background":   PaletteEntry(hex="#0B1020", source="auto"),
        "surface":      PaletteEntry(hex="#1A2138", source="auto"),
        "primary":      PaletteEntry(hex="#5B8DEF", source="auto"),
        "accent_1":     PaletteEntry(hex="#F472B6", source="auto"),
        "accent_2":     PaletteEntry(hex="#34D399", source="auto"),
        "text_primary": PaletteEntry(hex="#F8FAFC", source="auto"),
        "text_muted":   PaletteEntry(hex="#94A3B8", source="auto"),
        "text_inverse": PaletteEntry(hex="#0B1020", source="auto"),
    }
    return DeckContext(
        palette=palette,
        typography=Typography(
            heading_font="Inter", body_font="Inter", scale=TypographyScale(),
        ),
        composition=CompositionRules(
            mood="vibrant-tech",
            background_mode="dark",
            decoratives_allowed=[],
            decoratives_density="medium",
            min_negative_space=0.30,
        ),
        audience="marketing",
    )


def make_specs() -> list[SlideSpec]:
    bg = ShapeCall(fn="solid_bg", args={"role": "background"})

    return [
        SlideSpec(
            slide_index=1, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="title_text", args={
                    "text": "Cycle diagram", "anchor": "upper-left", "tier": "h1",
                    "role": "text_primary", "weight": 700, "width_frac": 0.6,
                }),
                ShapeCall(fn="cycle_diagram", args={
                    "items": ["Plan", "Build", "Measure", "Learn"],
                    "anchor": "center",
                    "role_node": "primary", "role_arrow": "accent_1",
                    "role_text": "text_inverse",
                }),
            ],
        ),
        SlideSpec(
            slide_index=2, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="title_text", args={
                    "text": "Org chart", "anchor": "upper-left", "tier": "h1",
                    "role": "text_primary", "weight": 700, "width_frac": 0.6,
                }),
                ShapeCall(fn="org_chart", args={
                    "root": "Product",
                    "children": ["Design", "Engineering", "Research", "Growth"],
                    "anchor": "center",
                    "role_root": "primary", "role_child": "surface",
                    "role_root_text": "text_inverse",
                    "role_child_text": "text_primary",
                    "role_line": "text_muted",
                }),
            ],
        ),
        SlideSpec(
            slide_index=3, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="title_text", args={
                    "text": "Timeline", "anchor": "upper-left", "tier": "h1",
                    "role": "text_primary", "weight": 700, "width_frac": 0.6,
                }),
                ShapeCall(fn="timeline", args={
                    "items": [
                        {"date": "Q1 '25", "label": "Closed seed round"},
                        {"date": "Q2 '25", "label": "First 100 users"},
                        {"date": "Q3 '25", "label": "$1M ARR"},
                        {"date": "Q4 '25", "label": "Series A"},
                        {"date": "Q1 '26", "label": "Enterprise launch"},
                    ],
                    "anchor": "center",
                    "role_line": "primary", "role_marker": "accent_1",
                    "role_text": "text_primary", "role_date": "text_muted",
                }),
            ],
        ),
        SlideSpec(
            slide_index=4, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="title_text", args={
                    "text": "Vertical process", "anchor": "upper-left",
                    "tier": "h1", "role": "text_primary",
                    "weight": 700, "width_frac": 0.6,
                }),
                ShapeCall(fn="vertical_process", args={
                    "items": ["Discover", "Design", "Develop", "Deploy"],
                    "anchor": "center",
                    "role_box": "primary", "role_arrow": "accent_1",
                    "role_text": "text_inverse",
                }),
            ],
        ),
        SlideSpec(
            slide_index=5, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="title_text", args={
                    "text": "Radial list", "anchor": "upper-left", "tier": "h1",
                    "role": "text_primary", "weight": 700, "width_frac": 0.6,
                }),
                ShapeCall(fn="radial_list", args={
                    "hub": "Core",
                    "items": ["Speed", "Reliability", "Security", "Scale", "Insight"],
                    "anchor": "center",
                    "role_hub": "primary", "role_node": "surface",
                    "role_hub_text": "text_inverse",
                    "role_node_text": "text_primary",
                    "role_line": "text_muted",
                }),
            ],
        ),
        SlideSpec(
            slide_index=6, intent="section-body", background=bg,
            elements=[
                ShapeCall(fn="swot_quad", args={
                    "quadrants": [
                        {"label": "Strengths", "items": [
                            "Strong brand", "Talented team", "Market fit",
                        ]},
                        {"label": "Weaknesses", "items": [
                            "Limited runway", "Single channel",
                        ]},
                        {"label": "Opportunities", "items": [
                            "EU expansion", "AI tailwind", "Enterprise tier",
                        ]},
                        {"label": "Threats", "items": [
                            "Big-tech entrants", "Regulation",
                        ]},
                    ],
                    "anchor": "center",
                    "role_a": "primary", "role_b": "accent_1",
                    "role_c": "accent_2", "role_d": "text_muted",
                    "role_header_text": "text_inverse",
                    "role_body_text": "text_primary",
                }),
            ],
        ),
    ]


def main() -> None:
    ctx = make_ctx()
    prs = new_presentation()
    for spec in make_specs():
        execute_slide(prs, ctx, spec)
        print(f"  rendered slide {spec.slide_index}: "
              f"{spec.elements[0].fn if spec.elements else '?'}")
    out = "/tmp/smoke_smartart.pptx"
    prs.save(out)
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
