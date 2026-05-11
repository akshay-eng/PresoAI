"""Composer — calls the LLM to produce a SlideSpec for one slide.

The LLM is asked to behave as a senior marketing-deck designer composing
slides from a fixed shape kit. To get marketing-grade output we provide:
  - The frozen DeckContext (palette + typography + mood)
  - The shape-kit signatures, filtered by mood
  - Compositional principles (layered, asymmetric, generous negative space)
  - Per-intent design playbooks (concrete recipes for hero/stats/quote/etc.)
  - 3 worked examples of slide_specs for tonally-similar archetypes

Output is parsed as SlideSpec and handed to the Validator.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage

from app.preso_pro.planning.slide_spec import DeckContext, ShapeCall, SlideSpec
from app.preso_pro.shape_kit import signatures_filtered

logger = structlog.get_logger()


SYSTEM_PROMPT = """You are a senior marketing-deck designer composing one slide.

You compose slides ONLY by emitting JSON that calls functions from this fixed shape kit:
{shape_kit_json}

Output is a single JSON object matching this schema:

{{
  "slide_index": <int>,
  "intent": "<the intent tag you were given>",
  "background": {{ "fn": "<function_name>", "args": {{...}} }} | null,
  "elements": [
    {{ "fn": "<function_name>", "args": {{...}} }},
    ...
  ]
}}

# Hard rules — violating any of these is a failure
- COLORS: never use hex codes. Reference palette role names ONLY:
  background, surface, primary, accent_1, accent_2, text_primary, text_muted, text_inverse.
- FONTS / SIZES: never specify font names or pixel sizes. Use typography tier
  names ONLY: display, h1, h2, body, caption.
- POSITIONS: only use the named anchors:
  upper-left, upper-center, upper-right, center-left, center, center-right,
  lower-left, lower-center, lower-right, diagonal-thirds-A, diagonal-thirds-B.
- FUNCTIONS: only call functions from the shape kit above. No invented names.

# Design principles
- LAYER, don't crowd. A great marketing slide has 3-5 elements: a background,
  one decorative accent, the main content, and at most one supporting element.
- ASYMMETRY beats centering. Anchor titles to upper-left or center-left; put
  decoratives in opposite corners. Diagonal-thirds anchors create dynamic compositions.
- GENEROUS negative space. Aim for at least 35% of the slide empty.
- DECORATIVE BUDGET. Hero/closing slides may have up to 2 decoratives.
  Body slides should have AT MOST 1 decorative.
- TITLE LENGTH. Titles should be 3-6 words for display tier, up to 8 words
  for h1. If the content is longer, break it into title + body_text.
- WHEN A SMARTART OR COMPOSITE IS THE FOCAL POINT (any smart_art_* function,
  timeline, cycle_diagram, swot_quad, radial_list, org_chart, vertical_process,
  numbered_steps, feature_grid, pyramid_layers), DO NOT scatter additional
  decoratives around it. The SmartArt / composite IS the visual richness.
  Random oversized_letter/oversized_number near it makes the slide look
  amateur, not abstract.

- PREFER NATIVE SMARTART. Whenever the slide intent matches a SmartArt
  function (smart_art_cycle, smart_art_chevron_process, smart_art_chevron_rows,
  smart_art_column_blocks, smart_art_hexagon_timeline, smart_art_org_chart,
  smart_art_horizontal_hierarchy, smart_art_trapezoid_blocks), CHOOSE THAT
  over the hand-rolled fallback. They render with full PowerPoint SmartArt
  fidelity. Only fall back to cycle_diagram/timeline/org_chart/etc. when the
  SmartArt function genuinely doesn't fit the slide's structure.

- FILL EVERY SHAPE WITH MEANINGFUL CONTENT. Never emit a SmartArt function
  with empty labels, "Item 1 / Item 2" placeholders, or single-word labels
  when you have real content available. The point of SmartArt is the structure
  CARRYING content — pull substance from the content_cue into every node.

- USE CHARTS LIBERALLY. Whenever the slide has any number, percentage, trend,
  comparison, or share-of-whole, REACH FOR A CHART (bar, stacked_bar, line,
  area, pie, donut, scatter) instead of just a stats_row of numbers. Decks
  with 4+ slides should include AT LEAST ONE chart; decks with 8+ slides
  should use 2-3 different chart types across the deck.

# Oversized_letter and oversized_number — strict rules
oversized_letter and oversized_number are ONLY appropriate when:
  (a) the slide has a small, simple main content (a single big stat, a single
      title, a quote) AND
  (b) the slide has NO SmartArt composite (no timeline, cycle_diagram,
      swot_quad, radial_list, org_chart, numbered_steps, feature_grid,
      pyramid_layers, vertical_process)
If both conditions are not met, do not include them.

# Anchor regions and the no-overlap rule
The 11 anchors split the slide into 3 vertical bands and 3 horizontal bands:
  upper band:  upper-left, upper-center, upper-right
  middle band: center-left, center, center-right (and diagonal-thirds-A)
  lower band:  lower-left, lower-center, lower-right (and diagonal-thirds-B)

CRITICAL — never place two TEXT elements (title_text, body_text, gradient_title,
bullet_list, two_column_text, quote_callout, glass_text_panel, stats_row) in
the SAME vertical band. They will overlap.

Correct pairings (title vs main-content):
  * title at upper-* → bullet_list/body_text/stats_row at center-* or lower-*
  * title at center-* → body_text at lower-* (NEVER another center-* anchor)
  * stats_row at center → title at upper-* (never center)
  * quote_callout at center → no other text element on that slide

Decoratives (accent_blob, oversized_letter, oversized_number, corner_accent_cluster,
half_circle, card_stack) MAY occupy the same band as text because they sit
behind/around content with low opacity.

# Tier by intent
  * hero / closing → display (max 6 words)
  * stats-row, section-body, timeline, pillars, cycle, matrix → h1 (max 8 words)
  * comparison, quote, org-chart → h2

# About card_stack and glass_text_panel
- card_stack is a BACKDROP only. It does not carry text by itself. If you use
  it, place a title_text or body_text element AT THE SAME ANCHOR on top.
- glass_text_panel HAS its own text — do not pair it with a separate title_text
  at the same anchor.
- Do not use a card_stack and a glass_text_panel on the same slide.

# Per-intent design playbooks
Use these as defaults. Anchors below are STRICT — they're the no-overlap-safe choices.

## hero (cover slide — short/iconic title, no supporting content)
Pick ONE archetype based on what the title evokes — DO NOT default to the same
recipe every time. Variety across decks is important.

A. Bold gradient title — gradient_title at center-left over mesh_gradient_bg,
   one oversized_letter/oversized_number decorative at lower-right
B. Stat-led hero — oversized_number at upper-right (large, opacity 1.0) as the
   focal point, title_text at lower-left, tier=h1
C. Big-quote hero — quote_callout at center over radial_gradient_bg, optional
   accent_blob in a corner
D. Minimal cover — title_text at center over solid_bg(role=primary), one
   corner_accent_cluster, no body text
E. Diagonal accent — diagonal_band_bg with gradient_title at upper-left and
   one accent shape (star/lightning_bolt) at center-right

Make the hero visually distinct from body slides — it's bigger, more decorative,
and the LLM should rotate among archetypes A-E across decks.

## stats-row OR data-driven slide
You have THREE strong choices for data-heavy slides — pick whichever fits:
A. stats_row (3-5 number tiles) — for KPI summaries
B. bar_chart / line_chart / area_chart — for trends and comparisons
C. pie_chart / donut_chart — for share/breakdown

Layout:
- background: solid_bg(role=background)
- 1 accent: gradient_strip(edge='left') OR corner_accent_cluster
- title: title_text at upper-center, tier=h1, width_frac=0.7, max 7 words
- main: ONE of stats_row | bar_chart | line_chart | pie_chart | donut_chart at center
- optional: oversized_number at a corner with low opacity

Use real numbers from the content cue. Charts must include categories AND a series.

## quote
- background: radial_gradient_bg(role_inner=primary, role_outer=background, focus='center')
- 1 decorative: accent_blob at upper-right OR lower-left, size 180-220, opacity 0.30-0.40
- main: quote_callout at center
- DO NOT add a separate title_text on this slide — quote_callout carries it all

## comparison
- background: solid_bg(role=surface) or diagonal_band_bg
- title: title_text at upper-center, tier=h2, width_frac=0.7
- main: two_column_text at lower-center (NOT center — that overlaps title's lower edge)

## section-body (default for content slides)
Pick the right composite for the content shape. PREFER real native SmartArt
(smart_art_*) over the hand-rolled fallbacks — they render with full PowerPoint
SmartArt fidelity and Microsoft's "SmartArt Design" ribbon stays active for
the user. The hand-rolled fallbacks (cycle_diagram, timeline, org_chart,
vertical_process, radial_list, swot_quad) are ONLY for when the SmartArt
function genuinely doesn't fit.

- "cycle" / "loop" / "iterative process" / "lifecycle" / "feedback loop"
  → smart_art_cycle (REAL SmartArt cycle3 layout, 3-6 phases)
  → fallback: cycle_diagram (only if SmartArt unavailable)
- "how it works" / "process" / "workflow" / "steps" / "stages"
  → smart_art_chevron_process (RICH chevron with body text under each step)
    OR smart_art_chevron_rows (vertical-stack chevrons with descriptions)
  → fallback: arrow_flow / numbered_steps / vertical_process
- "milestones" / "roadmap" / "timeline" / "phases" / "events over time"
  → smart_art_hexagon_timeline (HexagonTimeline — alternating hexagons + text)
  → fallback: timeline
- "team" / "structure" / "org" / "reporting" / "hierarchy of people"
  → smart_art_org_chart (root + children with native connectors)
  → fallback: org_chart
- "horizontal hierarchy" / "branching taxonomy" / "tree from left"
  → smart_art_horizontal_hierarchy (hierarchy5 — left-rooted tree)
- "tiers" / "levels" / "pyramid" / "maturity model" / "stack of layers"
  → smart_art_trapezoid_blocks (lProcess3 — stacked trapezoid layers)
  → fallback: pyramid_layers
- "pillars" / "columns" / "block structure" (parallel verticals each with body)
  → smart_art_column_blocks (lProcess2 — column blocks with sub-bullets)
- "features" / "capabilities" / "what we offer"
  → feature_grid (3-4 cards with icon + title + body) — much better than bullet_list
- "SWOT" / "BCG matrix" / 2x2 / four-quadrant frameworks
  → swot_quad (self-contained; each quadrant has its own header)
- "pillars" / "around the X" / "core principles" / "hub-and-spoke" radial
  → radial_list (center hub + 3-6 satellites)
- a generic short list of items (last resort, used sparingly)
  → bullet_list

CRITICAL: every smart_art_* function takes its actual content as args
(items[].title, items[].body, root.title, etc.). Do NOT call them with empty
labels or placeholders — fill them with the slide's real content from the
content_cue. The whole point of SmartArt is the structure CARRYING content.

Layout:
- background: solid_bg(role=background)
- 1 accent: gradient_strip(edge='left') OR corner_accent_cluster at lower-right
- title: title_text at upper-left, tier=h1, width_frac=0.75, max 5 words
- main: arrow_flow | numbered_steps | pyramid_layers | bullet_list (pick best fit) at lower-left or center
- optional decorative: oversized_number at lower-right OR star/lightning_bolt at upper-right

## cycle (lifecycle, iterative process, feedback loop)
- background: solid_bg(role=background) — keep it CLEAN
- title: title_text at upper-left, tier=h1, width_frac=0.5
- main: smart_art_cycle at center, items=3-6 phases (each with title + short body)
- DO NOT add oversized_letter, oversized_number, half_circle, star, blob, or
  lightning_bolt as "abstract" decoration. The SmartArt itself is the focal point.
  At most: one gradient_strip on an edge.

## timeline (milestones, roadmap, history, journey)
- background: solid_bg(role=background) — keep it CLEAN
- title: title_text at upper-left, tier=h1, width_frac=0.7
- main: smart_art_hexagon_timeline at center with 3-6 dated milestones
  (each with date + caption — fill the body text, no empty hexes)
- DO NOT add oversized_number/oversized_letter floating in the background.
  At most: one gradient_strip on an edge.

## process (steps, workflow, stages — sequential)
- background: solid_bg(role=background) — keep it CLEAN
- title: title_text at upper-left, tier=h1, width_frac=0.6
- main: smart_art_chevron_process at center with 4-6 steps
  (each chevron carries a step title + 1-line body; no empty chevrons)
- For longer step descriptions (3+ lines per step), prefer smart_art_chevron_rows.
- DO NOT decorate around the SmartArt — the chevrons ARE the structure.

## matrix (SWOT, BCG, 2x2 frameworks)
- background: solid_bg(role=background) — keep it CLEAN
- main: swot_quad at center with EXACTLY 4 quadrants
- swot_quad is SELF-CONTAINED. Do NOT add a separate title_text, do NOT add
  any decoratives (no blob, no oversized_letter, no half_circle, no star).
  The 4 quadrant headers ARE the structure.

## pillars (core principles, around-the-X, hub-and-spoke OR parallel columns)
- background: solid_bg(role=background) — keep it CLEAN
- title: title_text at upper-left, tier=h1, width_frac=0.5
- main: pick the right SmartArt for the shape:
    • Hub-and-spoke (one center concept, satellites around it) → radial_list
    • Parallel columns (3-5 pillars side-by-side, each with a body) →
      smart_art_column_blocks (lProcess2 — fills each column with content)
- DO NOT add oversized_number, half_circle, accent_blob, star, or
  lightning_bolt as background decoration. The structure IS the visual rhythm.
  At most: one gradient_strip on an edge.

## org-chart (team structure, reporting hierarchy)
- background: solid_bg or diagonal_band_bg
- title: title_text at upper-left, tier=h2, width_frac=0.5
- main: smart_art_org_chart at center with root + 2-5 children
  (each node carries name + role; fill them with real content)
- For LEFT-rooted horizontal taxonomies (parent on the left, children
  branching right), use smart_art_horizontal_hierarchy instead.
- DO NOT add abstract decoratives — the SmartArt connectors are the structure.

## levels / tiers / pyramid / maturity model
- background: solid_bg(role=background)
- title: title_text at upper-left, tier=h1, width_frac=0.6
- main: smart_art_trapezoid_blocks (lProcess3 — stacked trapezoid layers)
  with 3-5 tiers, each carrying a title + 1-line body
- DO NOT add abstract decoratives — the trapezoid layers ARE the structure.

## closing
There are TWO valid layouts; pick based on content:

A. CTA closing (no quote in the content):
   - background: mesh_gradient_bg (subtle — 2 blobs)
   - 1 decorative: corner_accent_cluster at upper-right
   - main: gradient_title at center, tier=display, width_frac=0.7
   - optional: body_text at lower-center with the CTA

B. Testimonial closing (content includes a quote/customer testimonial):
   - background: radial_gradient_bg(role_inner=primary, role_outer=background, focus='center')
   - 1 decorative: accent_blob in upper-right OR lower-left, opacity 0.30
   - main: quote_callout at center
   - DO NOT add a separate title_text on this slide — the quote is the headline.
     If a "title" was given for the slide, ignore it. The quote text and the
     attribution carry the message.

# Mood for THIS deck: {mood}
# Background mode: {background_mode}
# Decoratives density allowed: {decoratives_density}

Output ONLY the JSON object. No prose, no code fences."""


# Few-shot example specs to inject. They demonstrate the layered composition
# the prompt is asking for, in shapes the LLM can mirror.
FEW_SHOT_EXAMPLES = [
    {
        "intent": "hero",
        "title": "Analytics that ships itself",
        "spec": {
            "slide_index": 1,
            "intent": "hero",
            "background": {
                "fn": "mesh_gradient_bg",
                "args": {"roles": ["background", "primary", "accent_1", "accent_2"], "blob_count": 3},
            },
            "elements": [
                {"fn": "oversized_number", "args": {"text": "01", "anchor": "lower-right",
                                                    "role": "accent_2", "opacity": 0.12, "size": 400}},
                {"fn": "gradient_title", "args": {"text": "Analytics that ships itself",
                                                  "anchor": "center-left", "tier": "display",
                                                  "role_a": "text_primary", "role_b": "accent_1",
                                                  "weight": 800, "width_frac": 0.62}},
                {"fn": "body_text", "args": {"text": "No dashboards to build. Just answers.",
                                             "anchor": "lower-center", "tier": "body",
                                             "role": "text_muted", "width_frac": 0.45}},
            ],
        },
    },
    {
        "intent": "stats-row",
        "title": "Why customers choose us",
        "spec": {
            "slide_index": 4,
            "intent": "stats-row",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "gradient_strip", "args": {"role_a": "primary", "role_b": "accent_1",
                                                  "edge": "left", "thickness": 50}},
                {"fn": "title_text", "args": {"text": "Why customers choose us",
                                              "anchor": "upper-center", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.6}},
                {"fn": "stats_row", "args": {
                    "items": [
                        {"value": "47%", "label": "time saved"},
                        {"value": "$1.2M", "label": "pipeline lift"},
                        {"value": "3.4x", "label": "faster decisions"},
                        {"value": "18d", "label": "time to value"}
                    ],
                    "anchor": "center", "role": "accent_1"}},
            ],
        },
    },
    {
        "intent": "quote",
        "title": "Quote",
        "spec": {
            "slide_index": 5,
            "intent": "quote",
            "background": {"fn": "radial_gradient_bg",
                           "args": {"role_inner": "primary", "role_outer": "background", "focus": "center"}},
            "elements": [
                {"fn": "accent_blob", "args": {"position": "upper-right", "size": 200,
                                               "role": "accent_1", "opacity": 0.35}},
                {"fn": "quote_callout", "args": {
                    "text": "We deprecated three internal tools the week we onboarded.",
                    "attribution": "Sarah Chen, VP Data — Acme Inc.",
                    "anchor": "center", "role_quote": "text_primary", "role_accent": "accent_1"}},
            ],
        },
    },
    {
        "intent": "section-body",
        "title": "What you get",
        "spec": {
            "slide_index": 3,
            "intent": "section-body",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "gradient_strip", "args": {"role_a": "primary", "role_b": "accent_1",
                                                  "edge": "left", "thickness": 40}},
                {"fn": "title_text", "args": {"text": "What you get", "anchor": "upper-left",
                                              "tier": "h1", "role": "text_primary",
                                              "weight": 700, "width_frac": 0.75}},
                {"fn": "bullet_list", "args": {
                    "items": ["Real-time anomaly detection",
                              "AI-generated weekly summaries",
                              "Auto-routing to the right team",
                              "Slack & email integrations out of the box"],
                    "anchor": "lower-left", "tier": "body",
                    "role": "text_primary", "width_frac": 0.55}},
                {"fn": "corner_accent_cluster", "args": {"corner": "lower-right",
                                                         "role": "accent_1",
                                                         "secondary_role": "accent_2",
                                                         "scale": 0.9}},
            ],
        },
    },
    {
        "intent": "process",
        "title": "How it works",
        "spec": {
            "slide_index": 3,
            "intent": "process",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "How it works",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.75}},
                {"fn": "numbered_steps", "args": {
                    "items": [
                        {"label": "Connect any data source"},
                        {"label": "AI surfaces what changed"},
                        {"label": "Auto-route alerts to teams"}
                    ],
                    "anchor": "center",
                    "role_circle": "primary", "role_label": "text_primary"}},
                {"fn": "lightning_bolt", "args": {"anchor": "upper-right",
                                                  "size": 120, "role": "accent_1",
                                                  "opacity": 0.3}},
            ],
        },
    },
    {
        "intent": "data-trend",
        "title": "MRR growth",
        "spec": {
            "slide_index": 4,
            "intent": "data-trend",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "gradient_strip", "args": {"role_a": "primary", "role_b": "accent_1",
                                                  "edge": "left", "thickness": 40}},
                {"fn": "title_text", "args": {"text": "MRR growth, last 6 months",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.75}},
                {"fn": "line_chart", "args": {
                    "anchor": "center", "width_frac": 0.78, "height_frac": 0.55,
                    "title": "",
                    "categories": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
                    "series": [{"name": "MRR ($K)",
                                "values": [42, 58, 75, 102, 138, 180]}]}},
            ],
        },
    },
    {
        "intent": "features",
        "title": "Why teams pick FlowState",
        "spec": {
            "slide_index": 4,
            "intent": "features",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "Why teams pick FlowState",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.75}},
                {"fn": "feature_grid", "args": {
                    "items": [
                        {"icon": "⚡",
                         "title": "Instant connect",
                         "body": "Plug into any source in under 5 minutes."},
                        {"icon": "✦",
                         "title": "AI insight",
                         "body": "Surfaces what changed without a query."},
                        {"icon": "→",
                         "title": "Auto-route",
                         "body": "Alerts land in the right team's Slack."},
                    ],
                    "anchor": "center",
                    "role_card": "surface", "role_icon": "primary",
                    "role_title": "text_primary", "role_body": "text_muted"}},
            ],
        },
    },
    {
        "intent": "cycle",
        "title": "How we iterate",
        "spec": {
            "slide_index": 4,
            "intent": "cycle",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "How we iterate",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.5}},
                {"fn": "cycle_diagram", "args": {
                    "items": ["Plan", "Build", "Measure", "Learn"],
                    "anchor": "center",
                    "role_node": "primary", "role_arrow": "accent_1",
                    "role_text": "text_inverse"}},
                {"fn": "lightning_bolt", "args": {"anchor": "upper-right",
                                                  "size": 110, "role": "accent_2",
                                                  "opacity": 0.25}},
            ],
        },
    },
    {
        "intent": "timeline",
        "title": "How we got here",
        "spec": {
            "slide_index": 5,
            "intent": "timeline",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "gradient_strip", "args": {"role_a": "primary", "role_b": "accent_1",
                                                  "edge": "bottom", "thickness": 40}},
                {"fn": "title_text", "args": {"text": "How we got here",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.7}},
                {"fn": "timeline", "args": {
                    "items": [
                        {"date": "Q1 '24", "label": "Founded"},
                        {"date": "Q3 '24", "label": "First 100 users"},
                        {"date": "Q1 '25", "label": "$1M ARR"},
                        {"date": "Q3 '25", "label": "Series A"},
                        {"date": "Q1 '26", "label": "Enterprise"}
                    ],
                    "anchor": "center",
                    "role_line": "primary", "role_marker": "accent_1",
                    "role_text": "text_primary", "role_date": "text_muted"}},
            ],
        },
    },
    {
        "intent": "matrix",
        "title": "Our SWOT",
        "spec": {
            "slide_index": 6,
            "intent": "matrix",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "swot_quad", "args": {
                    "quadrants": [
                        {"label": "Strengths", "items": [
                            "Strong brand", "Talented team", "Product-market fit"]},
                        {"label": "Weaknesses", "items": [
                            "Limited runway", "Single channel"]},
                        {"label": "Opportunities", "items": [
                            "EU expansion", "AI tailwind", "Enterprise tier"]},
                        {"label": "Threats", "items": [
                            "Big-tech entrants", "Regulation"]}
                    ],
                    "anchor": "center",
                    "role_a": "primary", "role_b": "accent_1",
                    "role_c": "accent_2", "role_d": "text_muted",
                    "role_header_text": "text_inverse",
                    "role_body_text": "text_primary"}},
            ],
        },
    },
    {
        "intent": "pillars",
        "title": "Our four pillars",
        "spec": {
            "slide_index": 3,
            "intent": "pillars",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "Our four pillars",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.5}},
                {"fn": "radial_list", "args": {
                    "hub": "Mission",
                    "items": ["Speed", "Trust", "Insight", "Scale"],
                    "anchor": "center",
                    "role_hub": "primary", "role_node": "surface",
                    "role_hub_text": "text_inverse",
                    "role_node_text": "text_primary",
                    "role_line": "text_muted"}},
                {"fn": "corner_accent_cluster", "args": {"corner": "lower-right",
                                                         "role": "accent_1",
                                                         "secondary_role": "accent_2",
                                                         "scale": 0.8}},
            ],
        },
    },
    # ── Real-native-SmartArt few-shots — these are the preferred output ──
    {
        "intent": "cycle",
        "title": "How we iterate (real SmartArt)",
        "spec": {
            "slide_index": 4,
            "intent": "cycle",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "How we iterate",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.5}},
                {"fn": "smart_art_cycle", "args": {
                    "items": ["Plan", "Build", "Measure", "Learn", "Iterate"],
                    "anchor": "center", "size_frac": 0.72}},
            ],
        },
    },
    {
        "intent": "process",
        "title": "How it works (real SmartArt)",
        "spec": {
            "slide_index": 3,
            "intent": "process",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "How it works",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.6}},
                {"fn": "smart_art_chevron_process", "args": {
                    "items": [
                        "Discover", "Workshops + interviews",
                        "Build",    "Pilot deployment",
                        "Scale",    "Org-wide rollout"
                    ],
                    "anchor": "center", "size_frac": 0.85}},
            ],
        },
    },
    {
        "intent": "pillars",
        "title": "Our three pillars (real SmartArt)",
        "spec": {
            "slide_index": 3,
            "intent": "pillars",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "smart_art_trapezoid_blocks", "args": {
                    "items": [
                        "Customer first",  "We obsess over outcomes",      "Every decision starts here",
                        "Speed wins",      "We ship and iterate weekly",   "Speed beats polish early",
                        "Trust always",    "Security from day one",        "Predictability earns trust"
                    ],
                    "anchor": "center", "size_frac": 0.65}},
            ],
        },
    },
    {
        "intent": "timeline",
        "title": "Roadmap (real SmartArt)",
        "spec": {
            "slide_index": 5,
            "intent": "timeline",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "How we got here",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.6}},
                {"fn": "smart_art_hexagon_timeline", "args": {
                    "items": [
                        "Q1 2024", "Founded — closed seed round",
                        "Q3 2024", "First 1,000 users live",
                        "Q1 2026", "Series A — enterprise tier"
                    ],
                    "anchor": "center", "size_frac": 0.85}},
            ],
        },
    },
    {
        "intent": "matrix",
        "title": "Three pillars of value (real SmartArt)",
        "spec": {
            "slide_index": 6,
            "intent": "matrix",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "smart_art_column_blocks", "args": {
                    "items": [
                        "Speed",    "Sub-second responses",  "Always-on global edge",
                        "Trust",    "SOC2 compliant",         "Audit logs everywhere",
                        "Insight",  "AI-driven anomalies",    "Auto-routed alerts"
                    ],
                    "anchor": "center", "size_frac": 0.78}},
            ],
        },
    },
    {
        "intent": "share-breakdown",
        "title": "Customer mix",
        "spec": {
            "slide_index": 5,
            "intent": "share-breakdown",
            "background": {"fn": "solid_bg", "args": {"role": "background"}},
            "elements": [
                {"fn": "title_text", "args": {"text": "Customer mix",
                                              "anchor": "upper-left", "tier": "h1",
                                              "role": "text_primary", "weight": 700,
                                              "width_frac": 0.7}},
                {"fn": "donut_chart", "args": {
                    "anchor": "center-left", "width_frac": 0.42, "height_frac": 0.65,
                    "title": "",
                    "categories": ["Enterprise", "Mid-market", "SMB"],
                    "values": [55, 30, 15]}},
                {"fn": "stats_row", "args": {
                    "items": [
                        {"value": "55%", "label": "Enterprise"},
                        {"value": "30%", "label": "Mid-market"},
                        {"value": "15%", "label": "SMB"}
                    ],
                    "anchor": "lower-right", "role": "accent_1"}},
            ],
        },
    },
]


def _shape_kit_for_mood(ctx: DeckContext) -> str:
    allowed = ctx.composition.decoratives_allowed
    universal = [
        "solid_bg", "title_text", "body_text", "bullet_list", "data_callout",
        "gradient_title", "gradient_strip", "stats_row", "quote_callout",
    ]
    allowed_full = list(dict.fromkeys(list(allowed) + universal))
    sigs = signatures_filtered(allowed=allowed_full)
    return json.dumps(sigs, indent=2)


def _examples_message() -> str:
    """Render the few-shot examples as a single user-style guidance message."""
    parts = ["Here are example slide_specs to learn from:"]
    for ex in FEW_SHOT_EXAMPLES:
        parts.append(
            f"\n# Example — intent={ex['intent']}, title={ex['title']!r}\n"
            f"{json.dumps(ex['spec'], indent=2)}"
        )
    parts.append(
        "\nNotice how each example: layers exactly 3-5 elements, anchors content "
        "asymmetrically, uses one decorative at low opacity, and keeps titles short. "
        "Mirror this discipline."
    )
    return "\n".join(parts)


# Hard mapping from intent → required primary composite. When the orchestrator
# emits one of these intents, the LLM MUST use the named composite — substitutes
# (feature_grid, bullet_list, charts) are forbidden. This is what fixes the
# "LLM keeps defaulting to feature_grid for SmartArt-shaped content" problem.
INTENT_REQUIRED_COMPOSITE = {
    "matrix":    ("smart_art_column_blocks",
                  "Real native SmartArt: 3 column backgrounds × (title + 2 cells) = 9 strings. "
                  "Use the column titles as the framework's 4 quadrants if SWOT-shaped. "
                  "Do NOT use bullet_list or two_column_text."),
    "timeline":  ("smart_art_hexagon_timeline",
                  "Real native SmartArt: provide EXACTLY 6 strings as 3 alternating "
                  "{date, label} pairs (date1, label1, date2, label2, date3, label3). "
                  "Do NOT use a bar_chart, line_chart, or stats_row instead."),
    "pillars":   ("smart_art_trapezoid_blocks",
                  "Real native SmartArt: 3 trapezoid blocks × (title + 2 bullet lines) = 9 strings. "
                  "Use this for 'three pillars / three values / three commitments'. "
                  "Do NOT use feature_grid, stats_row, or bullet_list instead."),
    "cycle":     ("smart_art_cycle",
                  "Real native SmartArt: provide EXACTLY 5 short labels (each ≤18 chars). "
                  "Use this for any iterative/loop content (build-measure-learn, OODA, etc). "
                  "Do NOT use numbered_steps or arrow_flow — those are linear, this is cyclical."),
    "org-chart": ("smart_art_org_chart",
                  "Real native SmartArt: provide EXACTLY 4 strings — [root_label, child1, child2, child3]. "
                  "Do NOT use a feature_grid or bullet_list in place of the hierarchy."),
    "process":   ("smart_art_chevron_process",
                  "Real native SmartArt: provide EXACTLY 6 strings as 3 alternating "
                  "{title, caption} pairs. Use this for 'how it works / engagement flow / process'. "
                  "Premium marketing aesthetic — DO NOT use arrow_flow, numbered_steps, or "
                  "vertical_process instead."),
    "features":  ("smart_art_column_blocks",
                  "Real native SmartArt: 3 columns × (title + 2 cells) = 9 strings. "
                  "Use this for 'features / capabilities / what we offer' content. "
                  "Marketing-grade visual — DO NOT use feature_grid or bullet_list instead."),
}


def _strip_code_fence(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


async def compose_slide(
    llm: Any,
    ctx: DeckContext,
    *,
    slide_index: int,
    intent: str,
    title: str,
    content_cue: str,
) -> SlideSpec:
    """Generate one SlideSpec via LLM, parse, return."""

    sys_msg = SYSTEM_PROMPT.format(
        shape_kit_json=_shape_kit_for_mood(ctx),
        mood=ctx.composition.mood,
        background_mode=ctx.composition.background_mode,
        decoratives_density=ctx.composition.decoratives_density,
    )

    required = INTENT_REQUIRED_COMPOSITE.get(intent)
    required_block = ""
    if required:
        composite_name, composite_rule = required
        required_block = (
            f"\n*** HARD CONSTRAINT — DO NOT VIOLATE ***\n"
            f"This slide's intent is {intent!r}, which REQUIRES the `{composite_name}` "
            f"composite as the primary content element. {composite_rule}\n"
            f"If you output a slide_spec without a `{composite_name}` element, "
            f"you have failed.\n"
        )

    user_msg = (
        f"{_examples_message()}\n\n"
        f"Now compose slide {slide_index}.\n"
        f"Intent tag: {intent}\n"
        f"Title to use: {title!r}\n"
        f"Content cue: {content_cue}\n"
        f"{required_block}\n"
        f"Follow the playbook for intent={intent!r}. Layer 3-5 elements. "
        f"Aim for marketing-grade visual quality, not a basic content slide.\n\n"
        f"Output the slide_spec JSON now (no code fences, no prose)."
    )

    response = await llm.ainvoke([
        SystemMessage(content=sys_msg),
        HumanMessage(content=user_msg),
    ])

    raw = getattr(response, "content", str(response))
    if not isinstance(raw, str):
        raw = str(raw)
    cleaned = _strip_code_fence(raw)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error("preso_pro_composer_invalid_json", err=str(e), raw=cleaned[:500])
        raise

    bg = parsed.get("background")
    bg_call = ShapeCall(**bg) if isinstance(bg, dict) else None
    elements_raw = parsed.get("elements") or []
    elements = [ShapeCall(**e) for e in elements_raw if isinstance(e, dict)]

    return SlideSpec(
        slide_index=parsed.get("slide_index", slide_index),
        intent=parsed.get("intent", intent),
        background=bg_call,
        elements=elements,
    )
