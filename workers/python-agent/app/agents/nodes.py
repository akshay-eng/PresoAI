from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
from tavily import AsyncTavilyClient

from app.config import settings
from app.services.slide_vision import images_to_base64_messages
from app.models import (
    LLMConfig,
    PPTGenerationState,
    SlideSpec,
    OutlineItem,
    ResearchItem,
)
from app.services.llm_factory import get_model
from app.services.extraction import ThemeExtractor, ReferenceExtractor
from app.services.progress import ProgressPublisher
from app.services.knowledge_graph import KnowledgeGraphService
from app.services.logo_dev import extract_brand_mentions, resolve_brand_logos
from app.services.kroki import render_diagram
from app.services.kroki_skill import KROKI_SKILL_REFERENCE
from app.services.image_gen import generate_image
from app.services.s3 import S3Service

logger = structlog.get_logger()


# Skill block injected into the slide_writer system prompt. Teaches the LLM
# how to emit an IMAGE_GEN marker that the post-processor will turn into a
# real Gemini-generated photo + brand-color tint overlay + optional fade.
IMAGE_GEN_SKILL_REFERENCE = """
## PHOTO BACKGROUND (cover / divider slides ONLY)

You can request a real photo as a slide background by emitting ONE special
JavaScript COMMENT line at the very top of the slide's code:

    // IMAGE_GEN: prompt="<short photo description>" tint="<palette_hex>" tintOpacity=<25-50> fade="bottom"

The post-processor expands that single comment into:
  1. `slide.addImage(...)` for a Gemini-generated photo at full bleed.
  2. A semi-transparent brand-color tint over the photo.
  3. A subtle vertical fade behind your title text (if `fade=` is set).

Then your normal `slide.addText(...)` / `slide.addShape(...)` calls render
on top — fully editable in PowerPoint.

### When to use
- Cover slide of the deck (1 max).
- A section divider between major chapters.
- NEVER on content slides (tables, KPIs, diagrams).

### Fields (all in one comment line, no line breaks)
- `prompt`    — REQUIRED. Photo-realistic description, NO text in image.
- `tint`      — Hex (no #) from the LOCKED BRAND PALETTE. Required.
- `tintOpacity` — 25-50 usually looks right. Default 30.
- `fade`      — `"bottom"` if title sits at y≥4, `"top"` if title sits at
                y≤2.5, `"none"` (default) otherwise.
- `aspect`    — `"16:9"` (default), `"4:3"`, `"1:1"`, `"9:16"`.

### Example (entire cover slide)
```javascript
// IMAGE_GEN: prompt="A modern data center server hall, cool blue ambient light, cinematic, no people, no text" tint="0F2A4D" tintOpacity=30 fade="bottom"
slide.addText("The Self-Healing Cloud", { x: 0.7, y: 4.6, w: 11.9, h: 1.2, fontSize: 56, bold: true, color: "FFFFFF" });
slide.addText("Agentic AIOps for Enterprise Kubernetes", { x: 0.7, y: 5.9, w: 11.9, h: 0.7, fontSize: 24, color: "FFFFFF" });
slide.addText("CTO Office · May 2026", { x: 0.7, y: 6.7, w: 11.9, h: 0.5, fontSize: 18, color: "FFFFFF" });
```

### Hard rules
- The marker is a `//` COMMENT, not a string. Never put it inside
  `slide.addText("...")` — that would render the marker as visible text.
- ONE IMAGE_GEN per slide, ONE-ish per deck.
- Do NOT also emit `addShape(RECTANGLE, ...)` that covers the whole slide
  after the marker — the post-processor already provides tint + fade.
- `tint` MUST come from the locked palette block above.
"""


# Skill block teaching the LLM to use GRADIENT markers. pptxgenjs 4.0.1 has
# no native gradient fill, so the post-processor expands a single marker
# into a stack of thin semi-transparent rectangles that simulate a smooth
# color transition. The same machinery powers vignettes / fade-over-photo
# overlays via the `vertical-fade-bottom` and `radial-vignette` directions.
GRADIENT_SKILL_REFERENCE = """
## 🌈 GRADIENT FILLS & PHOTO FADE OVERLAYS

pptxgenjs has no native gradient. To get a real gradient look you emit a
single `// GRADIENT:` marker and the post-processor expands it into a
stack of semi-transparent rectangles (10-16 steps, smooth in PowerPoint).

### When to use it (BIG visual wins, use sparingly)
- **Cover / title backgrounds** — brand-primary → brand-accent vertical
  gradient. Replaces flat colored blocks.
- **Section dividers** — diagonal gradient strip behind the section title.
- **Photo darken-fade** — over IMAGE_GEN to make overlaid title text
  readable. Direction `vertical-fade-bottom`: transparent top → dark bottom.
- **Subtle KPI card background** — a soft top-to-bottom tonal shift gives
  cards depth without competing for attention.

### Marker syntax (single comment line — like IMAGE_GEN):
```javascript
// GRADIENT: from="HEX" to="HEX" direction="<dir>" x=<in> y=<in> w=<in> h=<in> steps=<n> fromOpacity=<0-100> toOpacity=<0-100>
```

| field         | meaning                                                       |
|---------------|---------------------------------------------------------------|
| `from` / `to` | start / end color, hex no `#` (e.g. `1A3A6B`).                |
| `direction`   | `vertical`, `horizontal`, `diagonal`, `radial`,               |
|               | `vertical-fade-bottom`, `vertical-fade-top`,                  |
|               | `horizontal-fade-right`, `horizontal-fade-left`.              |
|               | `*-fade-*` interpolates ONLY the opacity, keeping `to` color. |
| `steps`       | how many rectangles to stack. 10-14 is smooth, default 12.    |
| `fromOpacity` | transparency of the FIRST step (0=opaque, 100=invisible).     |
|               | Default 0 for solid gradients, 100 for fade-over-photo.       |
| `toOpacity`   | transparency of the LAST step. Default 0.                     |
| `x/y/w/h`     | placement in inches. Default = full bleed.                    |

### Cover gradient (no photo)
```javascript
// GRADIENT: from="1A3A6B" to="5BC0EB" direction="diagonal" x=0 y=0 w=13.33 h=7.5 steps=12
slide.addText("Agentic AIOps for Enterprise Kubernetes",
  { x: 0.7, y: 2.8, w: 9, h: 1.6, fontSize: 44, bold: true, color: "FFFFFF" });
```

### Cover photo + fade overlay (Cognizant-style)
The IMAGE_GEN line MUST come first (it goes at the back of the z-order).
The GRADIENT goes BETWEEN the photo and the title — text on top stays
crisp; photo fades into the brand color where the text sits.
```javascript
// IMAGE_GEN: prompt="A futuristic data center server hall, blue ambient light, cinematic, no people, no text" x=0 y=0 w=13.33 h=7.5 tint="" tintOpacity=0 aspect="16:9"
// GRADIENT: from="000000" to="1A3A6B" direction="vertical-fade-bottom" x=0 y=3.0 w=13.33 h=4.5 steps=14 fromOpacity=100 toOpacity=15
slide.addText("Agentic AIOps", { x: 0.7, y: 4.2, w: 11.9, h: 1.4, fontSize: 56, bold: true, color: "FFFFFF" });
slide.addText("Self-healing Kubernetes at enterprise scale",
  { x: 0.7, y: 5.7, w: 11.9, h: 0.7, fontSize: 22, color: "FFFFFF" });
```

### Radial vignette (focus the center of a slide)
```javascript
// GRADIENT: from="00000000" to="000000" direction="radial-vignette" x=0 y=0 w=13.33 h=7.5 steps=10 fromOpacity=100 toOpacity=40
```
(Transparent center, darker corners — great for centering attention on a
single hero element.)

### HARD RULES
- ONE photo + ONE fade overlay per cover. Two gradient stacks on the same
  region looks muddy.
- Don't gradient every slide — use it where the content benefits from
  depth (covers, section dividers, hero KPI cards). NEVER >50% of slides.
- Always use the locked brand palette for `from` / `to`.
- The marker MUST be a single line — multi-line markers won't be parsed.
- For fade-over-photo readability: title text should be `color: "FFFFFF"`
  (or pure brand-accent) at fontSize ≥ 36 bold.
"""


# Direction tokens recognized by _process_gradient_markers. Kept at module
# scope so the post-processor and the marker parser stay in sync.
GRADIENT_DIRECTIONS = {
    "vertical",
    "horizontal",
    "diagonal",
    "radial",
    "vertical-fade-bottom",
    "vertical-fade-top",
    "horizontal-fade-right",
    "horizontal-fade-left",
    "radial-vignette",
}


def _interp_color(c1: str, c2: str, t: float) -> str:
    """Linearly interpolate between two 6-digit hex colors. `t` in [0,1]."""
    def _h(c: str) -> tuple[int, int, int]:
        c = c.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        c = (c + "000000")[:6]
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)

    r1, g1, b1 = _h(c1)
    r2, g2, b2 = _h(c2)
    r = round(r1 + (r2 - r1) * t)
    g = round(g1 + (g2 - g1) * t)
    b = round(b1 + (b2 - b1) * t)
    return f"{r:02X}{g:02X}{b:02X}"


def _build_gradient_rects(
    *,
    from_color: str,
    to_color: str,
    direction: str,
    x: float,
    y: float,
    w: float,
    h: float,
    steps: int,
    from_opacity: int,
    to_opacity: int,
) -> list[str]:
    """Generate pptxgenjs addShape calls that stack into a smooth gradient.

    The trick: pptxgenjs supports per-shape `transparency` on a solid fill.
    Stacking ~12 thin rectangles with stepwise color AND/OR transparency
    produces something PowerPoint renders smoothly — and the user can
    still edit each rectangle by hand later.

    For *-fade-* directions, the COLOR stays at `to_color` and only the
    transparency interpolates (from `from_opacity` to `to_opacity`). For
    the others, the color AND a constant transparency (averaged) both
    apply per step.
    """
    steps = max(2, min(24, int(steps)))
    is_fade = "-fade-" in direction
    rects: list[str] = []

    if direction == "vertical" or direction == "vertical-fade-bottom" or direction == "vertical-fade-top":
        # Horizontal strips, height/steps each.
        strip_h = h / steps
        for i in range(steps):
            t = i / (steps - 1)
            if direction == "vertical-fade-top":
                t = 1 - t  # invert so top is opaque, bottom transparent
            color = to_color if is_fade else _interp_color(from_color, to_color, t)
            opacity = round(from_opacity + (to_opacity - from_opacity) * t)
            rects.append(
                f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                f'x: {x:.3f}, y: {y + i * strip_h:.3f}, w: {w:.3f}, h: {strip_h + 0.02:.3f}, '
                f'fill: {{ color: "{color}", transparency: {opacity} }}, '
                f'line: {{ color: "{color}", width: 0 }} }});'
            )
        return rects

    if direction == "horizontal" or direction in ("horizontal-fade-right", "horizontal-fade-left"):
        strip_w = w / steps
        for i in range(steps):
            t = i / (steps - 1)
            if direction == "horizontal-fade-left":
                t = 1 - t
            color = to_color if is_fade else _interp_color(from_color, to_color, t)
            opacity = round(from_opacity + (to_opacity - from_opacity) * t)
            rects.append(
                f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                f'x: {x + i * strip_w:.3f}, y: {y:.3f}, w: {strip_w + 0.02:.3f}, h: {h:.3f}, '
                f'fill: {{ color: "{color}", transparency: {opacity} }}, '
                f'line: {{ color: "{color}", width: 0 }} }});'
            )
        return rects

    if direction == "diagonal":
        # Diagonal-band approximation: stack horizontal strips but skew the
        # color blend so it reads as 45° (top-left → bottom-right).
        # pptxgenjs has no rotation on shapes for fills, so this is the
        # closest we can get without raw XML.
        strip_h = h / steps
        for i in range(steps):
            t = i / (steps - 1)
            color = _interp_color(from_color, to_color, t)
            opacity = round(from_opacity + (to_opacity - from_opacity) * t)
            offset_x = x - 0.6 + 1.2 * t  # slight horizontal shift per step
            rects.append(
                f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                f'x: {offset_x:.3f}, y: {y + i * strip_h:.3f}, w: {w + 1.2:.3f}, h: {strip_h + 0.02:.3f}, '
                f'fill: {{ color: "{color}", transparency: {opacity} }}, '
                f'line: {{ color: "{color}", width: 0 }} }});'
            )
        return rects

    if direction in ("radial", "radial-vignette"):
        # Concentric rectangles shrinking inward. The OUTER ring is the
        # `to` color (or its opacity); the CENTER is the `from` color/
        # opacity. For `radial-vignette` we keep `to_color` constant and
        # only fade transparency — exactly the corners-dark / center-clear
        # spotlight effect.
        # We iterate from the outer ring inward so center sits on top.
        cx, cy = x + w / 2, y + h / 2
        for i in range(steps):
            t = i / (steps - 1)
            shrink = 1 - t
            rect_w = w * shrink
            rect_h = h * shrink
            rect_x = cx - rect_w / 2
            rect_y = cy - rect_h / 2
            # Reverse: outer step = `to`, inner = `from`.
            color_t = 1 - t
            color = to_color if direction == "radial-vignette" else _interp_color(from_color, to_color, color_t)
            opacity = round(to_opacity + (from_opacity - to_opacity) * t)
            rects.append(
                f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                f'x: {rect_x:.3f}, y: {rect_y:.3f}, w: {rect_w:.3f}, h: {rect_h:.3f}, '
                f'fill: {{ color: "{color}", transparency: {opacity} }}, '
                f'line: {{ color: "{color}", width: 0 }} }});'
            )
        return rects

    return rects


async def _process_gradient_markers(slide_codes: list[dict]) -> list[dict]:
    """Expand `// GRADIENT:` markers into stacked-rect pptxgenjs code.

    Pure-Python — no network, no S3. Cheap to run on every slide. Skips
    slides that don't contain the marker word so it's near-free.
    """
    import re

    line_pattern = re.compile(r'//\s*GRADIENT:\s*(.+?)(?=\n|$)')
    kv_pattern = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^\s]+))')

    for slide in slide_codes:
        code = slide.get("code", "")
        if "GRADIENT:" not in code:
            continue

        matches = list(line_pattern.finditer(code))
        for m in reversed(matches):  # reverse to preserve offsets
            args_text = m.group(1).strip()
            kvs: dict[str, str] = {}
            for kvm in kv_pattern.finditer(args_text):
                key = kvm.group(1)
                val = kvm.group(2) if kvm.group(2) is not None else kvm.group(3)
                kvs[key] = val

            from_color = (kvs.get("from", "1A3A6B") or "1A3A6B").lstrip("#")
            to_color = (kvs.get("to", "5BC0EB") or "5BC0EB").lstrip("#")
            direction = (kvs.get("direction", "vertical") or "vertical").lower()
            if direction not in GRADIENT_DIRECTIONS:
                direction = "vertical"

            try:
                x = float(kvs.get("x", "0"))
                y = float(kvs.get("y", "0"))
                w = float(kvs.get("w", "13.33"))
                h = float(kvs.get("h", "7.5"))
                steps = int(kvs.get("steps", "12"))
                from_opacity = max(0, min(100, int(kvs.get("fromOpacity", "0"))))
                to_opacity = max(0, min(100, int(kvs.get("toOpacity", "0"))))
            except ValueError:
                x, y, w, h = 0.0, 0.0, 13.33, 7.5
                steps = 12
                from_opacity, to_opacity = 0, 0

            rects = _build_gradient_rects(
                from_color=from_color,
                to_color=to_color,
                direction=direction,
                x=x, y=y, w=w, h=h,
                steps=steps,
                from_opacity=from_opacity,
                to_opacity=to_opacity,
            )
            logger.info(
                "gradient_expanded",
                slide=slide.get("slide_number"),
                direction=direction,
                steps=len(rects),
            )
            replacement = "\n      ".join(rects)
            code = code[:m.start()] + replacement + code[m.end():]

        slide["code"] = code

    return slide_codes


def _build_pptx_diagram_fallback(diagram_type: str, source: str) -> str:
    """When Kroki rejects a diagram source (e.g. mermaid mindmap with multiple
    root nodes), render a *native* pptxgenjs concept-block from the source
    text so the slide isn't left empty. Best-effort: extracts identifier-
    like words / quoted strings from the source and lays them out as a
    title + bullet grid below the slide's title area.

    This is a graceful degradation — the original slide-writer prompt
    promised a diagram; we ship a styled list instead of a blank slide.
    """
    import re

    # Pull "labels" out of the source. Works for most kroki dialects:
    #   - quoted strings (D2 / mermaid)
    #   - identifiers after `(` for mindmap roots: `root((Brand DNA))`
    #   - bullet/indented lines for mermaid mindmap nested branches
    labels: list[str] = []
    # Quoted strings first.
    for m in re.finditer(r'"([^"\n]{2,80})"', source):
        labels.append(m.group(1).strip())
    # mindmap `root((...))` capture.
    for m in re.finditer(r'\(\(([^)]+)\)\)', source):
        labels.append(m.group(1).strip())
    # Indented non-quoted words (mermaid mindmap leaves and the like).
    # We always run this — even when we already captured a `((root))`,
    # because the branches/leaves are usually plain indented words that
    # neither the quoted-string nor the double-paren regex would catch.
    SKIP_PREFIXES = (
        "%%", "//", "graph ", "flowchart ", "mindmap", "timeline", "sankey",
        "sankey-beta", "section ", "quadrant", "quadrant-1", "quadrant-2",
        "quadrant-3", "quadrant-4", "journey", "title ", "x-axis", "y-axis",
        "bar ", "dateFormat", "@startuml", "@enduml", "direction:", "style ",
        "classDef", "config:", "init:", "subgraph", "end",
    )
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Skip the configuration / reserved-word lines.
        low = stripped.lower()
        if any(low.startswith(p) for p in SKIP_PREFIXES):
            continue
        # Strip leading id/dash/colon markers, then the line's leading id+":".
        cleaned = re.sub(r"^[\-\*•]\s*", "", stripped)
        cleaned = re.sub(r"^[A-Za-z_][\w-]*\s*-?->\s*", "", cleaned)
        # If the line is `id: "Label"` or `id: Label`, take the value side.
        if ":" in cleaned:
            cleaned = cleaned.split(":", 1)[1].strip()
        # Drop bracket / paren wrappers + double-paren content (already pulled).
        cleaned = re.sub(r"\(\([^)]+\)\)", "", cleaned).strip()
        cleaned = cleaned.strip(" ,;[](){}\"'")
        # Drop tokens that are reserved diagram keywords (e.g. "root" left
        # behind after stripping `((...))`).
        if cleaned.lower() in {"root", "node", "g", "subgraph", "end", "begin"}:
            continue
        if cleaned and 2 <= len(cleaned) <= 60:
            labels.append(cleaned)
    # Dedup while preserving order, cap.
    seen: set[str] = set()
    deduped: list[str] = []
    for lab in labels:
        key = lab.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(lab)
        if len(deduped) >= 8:
            break

    if not deduped:
        # Genuinely nothing to render — leave a small marker that's better
        # than complete silence.
        return (
            'slide.addText("Diagram unavailable", '
            '{ x: 1.0, y: 3.5, w: 11.33, h: 0.6, fontSize: 16, color: "888888", italic: true, align: "center" });'
        )

    # Lay out as a 2-column card grid below y=2.0.
    first = deduped[0]
    rest = deduped[1:]
    out: list[str] = []
    # Lead concept.
    out.append(
        f'slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {{ x: 4.66, y: 2.0, w: 4.0, h: 1.0, '
        f'fill: {{ color: "0F2A4D" }}, line: {{ color: "0F2A4D", width: 0 }}, rectRadius: 0.08 }});'
    )
    safe_first = first.replace('"', "'")
    out.append(
        f'slide.addText("{safe_first}", '
        f'{{ x: 4.66, y: 2.0, w: 4.0, h: 1.0, fontSize: 22, bold: true, color: "FAFAF7", align: "center", valign: "middle" }});'
    )
    # Branches in a 2-col grid below.
    col_w, row_h = 5.5, 0.9
    for i, label in enumerate(rest[:6]):
        col = i % 2
        row = i // 2
        bx = 0.8 + col * (col_w + 0.6)
        by = 3.3 + row * (row_h + 0.25)
        safe = label.replace('"', "'")
        out.append(
            f'slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {{ x: {bx:.2f}, y: {by:.2f}, w: {col_w:.2f}, h: {row_h:.2f}, '
            f'fill: {{ color: "5BC0EB" }}, line: {{ color: "5BC0EB", width: 0 }}, rectRadius: 0.06 }});'
        )
        out.append(
            f'slide.addText("{safe}", '
            f'{{ x: {bx + 0.2:.2f}, y: {by:.2f}, w: {col_w - 0.4:.2f}, h: {row_h:.2f}, fontSize: 16, color: "0F2A4D", valign: "middle" }});'
        )
    logger.info("diagram_fallback_rendered", type=diagram_type, labels=len(deduped))
    return "\n      ".join(out)


def _dedupe_logo_images(slide_codes: list[dict]) -> list[dict]:
    """Strip duplicate `img.logo.dev/<domain>` calls across slides. The same
    logo on multiple slides reads as a watermark; on a freshly-named brand
    (e.g. a deck's own product) logo.dev returns a generic placeholder
    which the LLM then sprinkles everywhere. We keep the FIRST occurrence
    of each unique domain (so an integration page that legitimately uses
    it still renders) and remove the rest.
    """
    import re

    # Match: slide.addImage({ ... path: "https://img.logo.dev/<domain>?..." ... });
    # Brace-balanced scan because options can nest (sizing: { ... }).
    HEAD = "slide.addImage("
    URL_RE = re.compile(r'path\s*:\s*["\'](https?://img\.logo\.dev/([^"\'\?]+)[^"\']*)["\']')

    seen_domains: set[str] = set()
    total_removed = 0

    for slide in slide_codes:
        code = slide.get("code", "")
        if "img.logo.dev" not in code:
            continue
        out: list[str] = []
        cursor = 0
        pos = code.find(HEAD)
        while pos != -1:
            brace_start = code.find("{", pos)
            if brace_start == -1:
                break
            depth = 0
            i = brace_start
            while i < len(code):
                ch = code[i]
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            if depth != 0:
                break
            brace_end = i
            end = brace_end + 1
            while end < len(code) and code[end] in " \t\n)":
                end += 1
            if end < len(code) and code[end] == ";":
                end += 1

            body = code[brace_start + 1 : brace_end]
            m = URL_RE.search(body)
            next_pos = code.find(HEAD, end)
            if m:
                domain = m.group(2).lower()
                if domain in seen_domains:
                    out.append(code[cursor:pos])
                    cursor = end
                    total_removed += 1
                else:
                    seen_domains.add(domain)
            pos = next_pos

        out.append(code[cursor:])
        slide["code"] = "".join(out)

    if total_removed:
        logger.info("logo_dedupe_stripped", removed=total_removed, kept_domains=sorted(seen_domains))
    return slide_codes


def _rescue_addkroki_calls(slide_codes: list[dict]) -> list[dict]:
    """The LLM has been inventing a non-existent API:
        addKroki(slide, 'mermaid', sourceVar, { x: 1, y: 2, w: 11, h: 5 });
    At runtime this throws a ReferenceError and the rest of the slide
    silently fails to render — leaving only whatever code ran before the
    invented call. Convert those calls into proper `// KROKI_DIAGRAM:`
    comment markers so the existing renderer picks them up. The geometry
    is dropped (the KROKI render places diagrams at a fixed slot the
    renderer chose anyway).
    """
    import re

    # addKroki(slide, "<type>", <varname or string>, { ... });
    call_re = re.compile(
        r'addKroki\(\s*\w+\s*,\s*["\'](\w+)["\']\s*,\s*'
        r'(?:`([\s\S]*?)`|"([^"]*?)"|\'([^\']*?)\'|(\w+))\s*,\s*'
        r'\{[^{}]*?\}\s*\)\s*;?',
        re.MULTILINE,
    )
    # const NAME = `multiline tpl` OR "string with \n";
    const_tpl_re = re.compile(r'const\s+(\w+)\s*=\s*`([\s\S]+?)`\s*;', re.MULTILINE)
    const_str_re = re.compile(r'const\s+(\w+)\s*=\s*"([\s\S]+?)"\s*;', re.MULTILINE)
    let_var_re = re.compile(r'(?:let|var)\s+(\w+)\s*=\s*["\'`]([\s\S]+?)["\'`]\s*;', re.MULTILINE)

    for slide in slide_codes:
        code = slide.get("code", "")
        if "addKroki(" not in code:
            continue

        # Resolve all const/let var names to their string content (with
        # JS escapes un-escaped). Backtick templates keep newlines as-is.
        consts: dict[str, str] = {}
        for m in const_tpl_re.finditer(code):
            consts[m.group(1)] = m.group(2)
        for m in const_str_re.finditer(code):
            consts[m.group(1)] = m.group(2).replace("\\n", "\n").replace('\\"', '"')
        for m in let_var_re.finditer(code):
            consts[m.group(1)] = m.group(2).replace("\\n", "\n").replace('\\"', '"')

        def _replace(m: re.Match) -> str:
            dtype = m.group(1)
            # Pick whichever capture group fired (`...`, "...", '...', varname).
            tpl_src = m.group(2)
            dq_src = m.group(3)
            sq_src = m.group(4)
            var_name = m.group(5)
            if tpl_src is not None:
                source = tpl_src
            elif dq_src is not None:
                source = dq_src.replace("\\n", "\n").replace('\\"', '"')
            elif sq_src is not None:
                source = sq_src.replace("\\n", "\n").replace("\\'", "'")
            elif var_name and var_name in consts:
                source = consts[var_name]
            else:
                return ""  # cannot resolve; drop the call

            source = source.strip()
            if not source:
                return ""

            lines = ["// KROKI_DIAGRAM:" + dtype]
            for line in source.splitlines():
                lines.append("// " + line)
            lines.append("// END_KROKI_DIAGRAM")
            logger.info("rescued_addkroki_call", type=dtype, slide=slide.get("slide_number"))
            return "\n".join(lines)

        code = call_re.sub(_replace, code)
        slide["code"] = code

    return slide_codes


def _rescue_kroki_in_addtext(slide_codes: list[dict]) -> list[dict]:
    """Pre-process: when the LLM emits the KROKI_DIAGRAM marker as a STRING
    inside `slide.addText("KROKI_DIAGRAM:type\\n<source>", ...)` instead of
    as a JS comment, the post-processor would skip it and the marker text
    would render as visible body copy. This scanner finds those patterns,
    extracts (type, source), and rewrites the line as the proper comment-
    style marker so `_process_kroki_diagrams` can pick it up.

    Same goes for sources stored in a const + concatenated:
        const def = "...";
        slide.addText("KROKI_DIAGRAM:mermaid\\n" + def, { ... });
    For that we look back up to 5 lines for a `const <name> = "..."`.
    """
    import re

    # Match: slide.addText("KROKI_DIAGRAM:<type>\n<src>" [+ <varname>], { ... });
    pattern = re.compile(
        r'slide\.addText\(\s*"KROKI_DIAGRAM:(\w+)(?:\\n|\n)([\s\S]*?)"'
        r'(?:\s*\+\s*(\w+))?'
        r'\s*,\s*\{[^{}]*?\}\s*\)\s*;?',
        re.MULTILINE,
    )
    const_pattern = re.compile(r'const\s+(\w+)\s*=\s*"([\s\S]+?)";', re.MULTILINE)

    for slide in slide_codes:
        code = slide.get("code", "")
        if "KROKI_DIAGRAM:" not in code or "addText" not in code:
            continue

        # Build a map of const_name -> string literal for resolution.
        consts: dict[str, str] = {}
        for cm in const_pattern.finditer(code):
            # Un-escape common literal escapes that appear inside JS strings.
            val = cm.group(2).replace("\\n", "\n").replace('\\"', '"').replace("\\'", "'")
            consts[cm.group(1)] = val

        def _replace(m: re.Match) -> str:
            dtype = m.group(1)
            head_src = m.group(2).replace("\\n", "\n").replace('\\"', '"').replace("\\'", "'")
            tail_var = m.group(3)
            tail_src = consts.get(tail_var, "") if tail_var else ""
            source = (head_src + ("\n" + tail_src if tail_src else "")).strip()
            if not source:
                return ""  # delete the malformed call
            # Re-emit as a proper comment-style marker. Each source line
            # becomes a `// ...` so the existing parser regex matches.
            lines = ["// KROKI_DIAGRAM:" + dtype]
            for line in source.splitlines():
                lines.append("// " + line)
            lines.append("// END_KROKI_DIAGRAM")
            logger.info("rescued_kroki_from_addtext", type=dtype, slide=slide.get("slide_number"))
            return "\n".join(lines)

        code = pattern.sub(_replace, code)
        slide["code"] = code

    return slide_codes


async def _process_kroki_diagrams(slide_codes: list[dict], job_id: str) -> list[dict]:
    """Find KROKI_DIAGRAM markers in slide code, render via Kroki, upload to S3, replace with image URL."""
    import re

    pattern = re.compile(
        r'//\s*KROKI_DIAGRAM:(\w+)\s*\n((?://.*\n)*?)//\s*END_KROKI_DIAGRAM',
        re.MULTILINE,
    )

    s3 = S3Service()
    diagram_idx = 0

    for slide in slide_codes:
        code = slide.get("code", "")
        if "KROKI_DIAGRAM" not in code:
            continue

        matches = list(pattern.finditer(code))
        for m in reversed(matches):  # reverse to preserve offsets
            diagram_type = m.group(1).strip()
            raw_lines = m.group(2)
            source = "\n".join(
                line.lstrip("/").strip() for line in raw_lines.split("\n") if line.strip()
            )

            if not source:
                continue

            # Render via Kroki API (PNG for pptxgenjs compatibility)
            image_bytes = await render_diagram(diagram_type, source, "png")

            # Reject not just None but also trivially-tiny outputs. Kroki
            # returns a 200 OK with a near-empty image when the source has
            # subtle syntax errors (D2 with bare identifiers as labels →
            # renders as a couple of dots, ~600-900 B). Threshold tuned
            # so legitimately small charts (mermaid sankey-beta ~3 KB,
            # quadrantChart ~4 KB) still pass — only the truly-empty
            # renders are rejected.
            MIN_DIAGRAM_BYTES = 1500
            looks_broken = bool(image_bytes) and len(image_bytes) < MIN_DIAGRAM_BYTES

            if not image_bytes or looks_broken:
                logger.error(
                    "kroki_render_failed_or_broken",
                    type=diagram_type,
                    slide=slide.get("slide_number"),
                    bytes=(len(image_bytes) if image_bytes else 0),
                    reason="too_small" if looks_broken else "no_response",
                    source_preview=source[:200],
                )
                # Fallback: build a native pptxgenjs concept-map / list from
                # the source instead of leaving an empty slide. Especially
                # important for mindmap/timeline/sankey where Kroki is
                # finicky about syntax — better to ship SOMETHING than a
                # blank slide with just the title.
                fallback_code = _build_pptx_diagram_fallback(diagram_type, source)
                code = code[:m.start()] + fallback_code + code[m.end():]
                continue

            # Encode as base64 data URI and embed directly — avoids HTTP/HTTPS fetch issues
            import base64 as b64
            b64_data = b64.b64encode(image_bytes).decode("ascii")
            logger.info("kroki_diagram_rendered", size=len(image_bytes), slide=slide.get("slide_number"))

            # Also upload to S3 for future reference (non-blocking)
            s3_key = f"diagrams/{job_id}/diagram_{diagram_idx}.png"
            diagram_idx += 1
            try:
                s3.upload_bytes(image_bytes, s3_key, content_type="image/png")
            except Exception:
                pass  # S3 upload is optional

            # Embed as base64 data in the slide code
            replacement = (
                f'slide.addImage({{ data: "image/png;base64,{b64_data}", '
                f'x: 1.0, y: 1.5, w: 11.33, h: 4.5 }});'
            )
            code = code[:m.start()] + replacement + code[m.end():]

        slide["code"] = code

    return slide_codes


async def _process_generated_images(
    slide_codes: list[dict],
    job_id: str,
    api_key: str | None,
) -> list[dict]:
    """Render IMAGE_GEN markers via Gemini Nano Banana.

    Marker syntax the slide-writer emits:

        // IMAGE_GEN: prompt="describe the photo" x=0.0 y=0.0 w=13.33 h=7.5 \\
        //           tint="#1A3A6B" tintOpacity=55 aspect="16:9"

    On render we:
      1. Generate a JPEG via the image_gen service.
      2. Upload it to S3 (so the .pptx stays portable + we can re-render later).
      3. Replace the marker with TWO pptxgenjs calls — `slide.addImage` for
         the photo, then `slide.addShape` with a transparent rect for the
         brand-color tint overlay. Text added by the slide on top of these
         remains fully editable in PowerPoint.

    On failure (no key, API error, etc.) we replace the marker with a
    solid brand-tinted rectangle so the slide still renders cleanly.
    """
    import base64 as b64lib
    import re

    # Capture the raw marker line; everything between IMAGE_GEN: and the
    # newline is parsed as `key=value` (or `key="value with spaces"`)
    # tokens. The marker is a SINGLE comment line — multi-line is awkward
    # since the slide writer emits straight JS.
    line_pattern = re.compile(r'//\s*IMAGE_GEN:\s*(.+?)(?=\n|$)')
    kv_pattern = re.compile(r'(\w+)\s*=\s*(?:"([^"]*)"|([^\s]+))')

    s3 = S3Service()
    img_idx = 0

    for slide in slide_codes:
        code = slide.get("code", "")
        if "IMAGE_GEN" not in code:
            continue

        matches = list(line_pattern.finditer(code))
        for m in reversed(matches):  # reverse-iterate to preserve offsets
            args_text = m.group(1).strip()
            kvs: dict[str, str] = {}
            for kvm in kv_pattern.finditer(args_text):
                key = kvm.group(1)
                val = kvm.group(2) if kvm.group(2) is not None else kvm.group(3)
                kvs[key] = val

            prompt = kvs.get("prompt", "").strip()
            if not prompt:
                # Marker without a prompt → drop it silently.
                code = code[:m.start()] + code[m.end():]
                continue

            # Geometry (defaults = full-bleed 16:9 slide). pptxgenjs uses
            # inches; LAYOUT_WIDE is 13.33 × 7.5.
            try:
                x = float(kvs.get("x", "0"))
                y = float(kvs.get("y", "0"))
                w = float(kvs.get("w", "13.33"))
                h = float(kvs.get("h", "7.5"))
            except ValueError:
                x, y, w, h = 0.0, 0.0, 13.33, 7.5

            aspect = kvs.get("aspect", "16:9")
            tint = (kvs.get("tint", "") or "").lstrip("#")
            try:
                tint_opacity = max(0, min(100, int(kvs.get("tintOpacity", "40"))))
            except ValueError:
                tint_opacity = 40
            # fade= produces an auto-positioned vertical fade overlay so the
            # LLM doesn't need to manually compose a GRADIENT marker on top
            # of IMAGE_GEN (and inevitably get the geometry/opacity wrong).
            fade_mode = (kvs.get("fade", "none") or "none").lower()
            if fade_mode not in ("top", "bottom", "none"):
                fade_mode = "none"

            replacement_parts: list[str] = []

            # ── 1. Generate the photo. ────────────────────────────────
            image_bytes = await generate_image(prompt, api_key=api_key, aspect_ratio=aspect)

            if image_bytes:
                b64 = b64lib.b64encode(image_bytes).decode("ascii")
                logger.info(
                    "image_gen_embedded",
                    slide=slide.get("slide_number"),
                    bytes=len(image_bytes),
                    aspect=aspect,
                    prompt_preview=prompt[:80],
                )

                # Best-effort S3 mirror (non-blocking).
                try:
                    s3_key = f"generated-images/{job_id}/img_{img_idx}.jpg"
                    s3.upload_bytes(image_bytes, s3_key, content_type="image/jpeg")
                except Exception:
                    pass
                img_idx += 1

                replacement_parts.append(
                    f'slide.addImage({{ data: "image/jpeg;base64,{b64}", '
                    f'x: {x:.3f}, y: {y:.3f}, w: {w:.3f}, h: {h:.3f} }});'
                )
            else:
                # Fallback: solid brand-color rectangle PLUS a subtle
                # diagonal gradient strip so the cover doesn't look like a
                # plain colored card. The text the slide-writer added on
                # top of the marker still renders over the rectangle.
                fallback_color = tint or "1A3A6B"
                logger.warning(
                    "image_gen_fallback_to_color",
                    slide=slide.get("slide_number"),
                    color=fallback_color,
                    reason="nano_banana_unavailable_or_quota",
                )
                # Base rectangle.
                replacement_parts.append(
                    f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                    f'x: {x:.3f}, y: {y:.3f}, w: {w:.3f}, h: {h:.3f}, '
                    f'fill: {{ color: "{fallback_color}" }}, '
                    f'line: {{ color: "{fallback_color}", width: 0 }} }});'
                )
                # Subtle highlight band — a thin lighter rectangle near the
                # top, low opacity. Adds visual depth without competing
                # with overlaid title text.
                replacement_parts.append(
                    f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                    f'x: {x:.3f}, y: {y:.3f}, w: {w:.3f}, h: {h*0.45:.3f}, '
                    f'fill: {{ color: "FFFFFF", transparency: 88 }}, '
                    f'line: {{ color: "FFFFFF", width: 0 }} }});'
                )

            # ── 2. Tint overlay (uniform). Only emit if tint+opacity>0;
            #       a 0-opacity tint is a no-op and just adds clutter.
            if tint and tint_opacity > 0 and image_bytes:
                replacement_parts.append(
                    f'slide.addShape(pres.shapes.RECTANGLE, {{ '
                    f'x: {x:.3f}, y: {y:.3f}, w: {w:.3f}, h: {h:.3f}, '
                    f'fill: {{ color: "{tint}", transparency: {tint_opacity} }}, '
                    f'line: {{ color: "{tint}", width: 0 }} }});'
                )

            # ── 3. Optional fade. Auto-positioned: `bottom` covers the
            #       lower 45% of the photo area, fading from transparent
            #       at the top of that band to ~mostly-opaque tint at the
            #       slide bottom. `top` mirrors it. Keeps the centre of
            #       the photo untouched so it still reads as a photo.
            if image_bytes and fade_mode in ("top", "bottom") and tint:
                fade_h = h * 0.45
                fade_y = (y + h - fade_h) if fade_mode == "bottom" else y
                # Direction picks which end is opaque (the text-side).
                direction = "vertical-fade-bottom" if fade_mode == "bottom" else "vertical-fade-top"
                # The fade re-uses GRADIENT's _build_gradient_rects so we
                # get the same smooth 14-strip render.
                fade_rects = _build_gradient_rects(
                    from_color=tint, to_color=tint,
                    direction=direction,
                    x=x, y=fade_y, w=w, h=fade_h,
                    steps=14,
                    from_opacity=100,  # invisible at the photo edge
                    to_opacity=10,     # nearly opaque at the slide edge
                )
                replacement_parts.extend(fade_rects)

            replacement = "\n      ".join(replacement_parts)
            code = code[:m.start()] + replacement + code[m.end():]

        # Defensive cleanup: strip any LLM-emitted full-bleed RECTANGLE
        # that lands AFTER the image (it would bury the photo).
        # Pattern matches an `addShape(pres.shapes.RECTANGLE, { ... x: 0...
        # w: 13... h: 7.x ... })` regardless of order of fields. We only
        # remove rects whose bounding box is >= 90% of slide area, since
        # the LLM might legitimately place a smaller decorative rect.
        code = _strip_fullbleed_rects_after_image(code)
        slide["code"] = code

    return slide_codes


def _strip_fullbleed_rects_after_image(code: str) -> str:
    """Remove `addShape(pres.shapes.RECTANGLE, { ... })` calls whose bounding
    box covers ~90%+ of the slide AND that appear AFTER the first
    `slide.addImage(` call. Defensive guard: the LLM has a habit of
    drawing a full-bleed brand-color rect to "dim" the photo even when
    IMAGE_GEN's tint+fade already do that.

    Uses a brace-balanced scanner instead of a regex because the shape
    options contain nested objects (`fill: { color: ... }`) which a flat
    regex can't match across.
    """
    import re

    first_image = code.find("slide.addImage(")
    if first_image == -1:
        return code

    SHAPE_HEAD = "slide.addShape(pres.shapes.RECTANGLE"
    NUM_RE = re.compile(r"\b(x|y|w|h)\s*:\s*(-?\d+(?:\.\d+)?)")

    removed = 0
    out: list[str] = []
    cursor = 0
    pos = code.find(SHAPE_HEAD, first_image)
    while pos != -1:
        # Find the comma and opening `{` after the shape head.
        brace_start = code.find("{", pos)
        if brace_start == -1:
            break
        # Brace-balanced scan to find the matching closing `}`.
        depth = 0
        i = brace_start
        while i < len(code):
            ch = code[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            break
        brace_end = i
        # Walk past `)` and optional `;`.
        end = brace_end + 1
        while end < len(code) and code[end] in " \t\n)":
            end += 1
        if end < len(code) and code[end] == ";":
            end += 1

        body = code[brace_start + 1 : brace_end]
        vals = {k: float(v) for k, v in NUM_RE.findall(body)}
        x, y, w, h = vals.get("x"), vals.get("y"), vals.get("w"), vals.get("h")
        next_pos = code.find(SHAPE_HEAD, end)

        if (
            x is not None and y is not None and w is not None and h is not None
            and x <= 0.3 and y <= 0.3 and w * h >= 90
        ):
            out.append(code[cursor:pos])
            cursor = end
            removed += 1

        pos = next_pos

    if removed:
        out.append(code[cursor:])
        logger.info("stripped_fullbleed_rects_over_image", count=removed)
        return "".join(out)
    return code


def _build_visual_context(state: PPTGenerationState) -> list[dict]:
    """Build multimodal message parts from reference collages and chat images.

    Returns a list of content parts (text + image_url dicts) that can be
    appended to a HumanMessage's content to make it multimodal.
    """
    parts: list[dict] = []

    # Reference PPTX visual collages (created in process_references)
    ref_visual = state.get("reference_visual_parts", [])
    if ref_visual:
        parts.append({"type": "text", "text": "\n\n## Visual Reference (from uploaded PPTX slides — match this style):"})
        parts.extend(ref_visual)

    # Chat images (pasted by user)
    chat_keys = state.get("chat_image_keys", [])
    if chat_keys:
        from app.services.s3 import S3Service
        import base64
        s3 = S3Service()
        parts.append({"type": "text", "text": "\n\n## User-provided reference images:"})
        for i, key in enumerate(chat_keys[:5]):  # Max 5 images
            try:
                data = s3.download_bytes(key)
                b64 = base64.b64encode(data).decode("utf-8")
                fmt = "jpeg" if data[:2] == b'\xff\xd8' else "png"
                parts.append({"type": "text", "text": f"\n[User image {i + 1}]"})
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/{fmt};base64,{b64}", "detail": "high"},
                })
            except Exception as e:
                logger.warn("chat_image_download_failed", key=key, error=str(e))

    return parts


# ─── Design guidelines from pptx skill ───
PPTX_DESIGN_GUIDELINES = """
## Design Rules (from pptx skill)
- Every slide MUST have a visual element — image placeholder, chart, icon, or shape. Text-only slides are forbidden.
- Don't create boring slides. Plain bullets on white background won't impress anyone.
- Pick a bold, content-informed color palette specific to THIS topic. NEVER reach for the same default navy + cyan + red across every deck — that signals lazy templating. Read the topic, then choose a palette whose mood matches it (finance ≠ healthcare ≠ AI ≠ sustainability).
- Dominance over equality: one color dominates (60-70%), 1-2 supporting, one sharp accent.
- Commit to ONE visual motif and repeat it across every slide.
- USE VARIED LAYOUTS — monotonous presentations are a common failure mode:
  * Two-column (text left, illustration right)
  * Icon + text rows (icon in colored circle, bold header, description)
  * 2x2 or 2x3 grid with content blocks
  * Half-bleed image with content overlay
  * Large stat callouts (big numbers 60-72pt with small labels)
  * Timeline or process flow with numbered steps
- Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure).
- Choose an interesting font pairing — don't default to Arial.
"""


def _get_knowledge_graph_context(state: PPTGenerationState) -> str:
    """Fetch the user's design knowledge graph context if available."""
    user_id = state.get("user_id", "")
    if not user_id:
        return ""
    try:
        kg = KnowledgeGraphService(user_id)
        return kg.get_design_context()
    except Exception as e:
        logger.warn("knowledge_graph_fetch_failed", error=str(e))
        return ""


def _get_project_memory_context(state: PPTGenerationState) -> str:
    """Return the per-project memory brief built by the worker.

    The worker preloads this into state["project_context"] before the graph
    runs. We read it from state (not re-fetched) so every node sees a
    consistent snapshot for the duration of the job.
    """
    return state.get("project_context", "") or ""


def _get_llm(state: PPTGenerationState, temperature: float = 0.7, max_tokens: int | None = None) -> Any:
    model_cfg = state.get("selected_model", {})
    tokens = max_tokens or model_cfg.get("max_tokens", 8192)
    config = LLMConfig(
        provider=model_cfg.get("provider", "openai"),
        model=model_cfg.get("model", "gpt-4o"),
        base_url=model_cfg.get("base_url"),
        api_key=model_cfg.get("api_key"),
        temperature=temperature,
        max_tokens=tokens,
    )
    return get_model(config)


# Fast/cheap model used for UTILITY steps — query generation, prompt
# enhancement, reflection, intent classification, naming. These steps don't
# need a Pro-tier reasoner; a small flash-class model returns in ~3-8s vs
# 30-60s for Pro. Switching just these steps cuts ~90s off every job.
#
# Mapping rules:
#   google     → gemini-2.5-flash
#   anthropic  → claude-3-5-haiku-latest
#   openai     → gpt-4o-mini
#   mistral    → mistral-small-latest
# Falls back to the user's chosen model if we can't map (preserves correctness).
_FAST_MODELS = {
    "google": "gemini-2.5-flash",
    "anthropic": "claude-3-5-haiku-latest",
    "openai": "gpt-4o-mini",
    "mistral": "mistral-small-latest",
}


def _get_fast_llm(state: PPTGenerationState, temperature: float = 0.3, max_tokens: int = 2048) -> Any:
    """Cheap/fast LLM for utility steps. Falls back to the user's chosen
    model when we don't have a known small variant for that provider."""
    model_cfg = state.get("selected_model", {})
    provider = (model_cfg.get("provider") or "openai").lower()
    fast_model = _FAST_MODELS.get(provider) or model_cfg.get("model", "gpt-4o")
    config = LLMConfig(
        provider=provider,
        model=fast_model,
        base_url=model_cfg.get("base_url"),
        api_key=model_cfg.get("api_key"),
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return get_model(config)


def _get_publisher(state: PPTGenerationState) -> ProgressPublisher:
    return ProgressPublisher(state.get("job_id", "unknown"))


class ResearchQueries(BaseModel):
    queries: list[str] = Field(description="6-8 targeted research queries")


class OutlineOutput(BaseModel):
    outline: list[OutlineItem] = Field(description="Slide outline")


class SlidesOutput(BaseModel):
    slides: list[SlideSpec] = Field(description="Full slide specifications")


async def extract_template(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("extract_template", 0.05, "Extracting template theme...")

    template_key = state.get("template_s3_key", "")
    if not template_key:
        # Preserve any theme_config the worker seeded from a selected style
        # profile — wiping it here would force slide_writer back to a generic palette.
        existing = state.get("theme_config", {}) or {}
        logger.info("no_template_provided, preserving_seed_theme", has_seed=bool(existing))
        await publisher.publish("extract_template", 0.1, "No template provided, using defaults")
        await publisher.close()
        return {"theme_config": existing, "current_phase": "extract_template"}

    try:
        extractor = ThemeExtractor()
        theme = extractor.extract(template_key)
        theme_dict = theme.model_dump()
        await publisher.publish("extract_template", 0.1, "Template theme extracted")
        await publisher.close()
        return {"theme_config": theme_dict, "current_phase": "extract_template"}
    except Exception as e:
        logger.error("template_extraction_failed", error=str(e))
        await publisher.publish("extract_template", 0.1, f"Template extraction failed: {e}")
        await publisher.close()
        return {"theme_config": {}, "current_phase": "extract_template", "error": str(e)}


async def process_references(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("process_references", 0.15, "Processing reference files...")

    ref_keys = state.get("reference_file_keys", [])
    if not ref_keys:
        logger.info("no_reference_files")
        await publisher.publish("process_references", 0.2, "No reference files to process")
        await publisher.close()
        return {"reference_context": "", "reference_visual_parts": [], "current_phase": "process_references"}

    from app.services.slide_vision import pptx_to_images, create_collages, images_to_base64_messages
    from app.services.s3 import S3Service

    extractor = ReferenceExtractor()
    s3 = S3Service()
    all_texts: list[str] = []
    all_visual_parts: list[dict] = []

    IMAGE_SUFFIXES = {"png", "jpg", "jpeg", "webp", "gif", "svg"}

    for i, key in enumerate(ref_keys):
        try:
            suffix = key.rsplit(".", 1)[-1] if "." in key else "txt"
            suffix_lower = suffix.lower()

            # Image references: skip text extraction (there is none), attach
            # them as multimodal vision parts so the planner + writer can SEE
            # the user's reference images (brand swatches, mood boards,
            # competitor screenshots, etc.).
            if suffix_lower in IMAGE_SUFFIXES:
                try:
                    import base64
                    img_bytes = s3.download_bytes(key)
                    b64 = base64.b64encode(img_bytes).decode("ascii")
                    mime = "svg+xml" if suffix_lower == "svg" else (
                        "jpeg" if suffix_lower in ("jpg", "jpeg") else suffix_lower
                    )
                    all_visual_parts.append({
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/{mime};base64,{b64}",
                            "detail": "high",
                        },
                    })
                    all_texts.append(
                        f"[Reference image: {key.rsplit('/', 1)[-1]} — see attached]"
                    )
                    logger.info("reference_image_attached", key=key, bytes=len(img_bytes))
                except Exception as ie:
                    logger.warn("reference_image_attach_failed", key=key, error=str(ie))
                progress = 0.15 + (0.05 * (i + 1) / len(ref_keys))
                await publisher.publish(
                    "process_references",
                    progress,
                    f"Processed reference {i + 1}/{len(ref_keys)}",
                )
                continue

            text, _ = extractor.extract(key, suffix)
            all_texts.append(text)

            # For PPTX files: also create visual collages for the LLM
            if suffix_lower in ("pptx", "ppt"):
                try:
                    tmp_path = s3.download_to_temp(key, f".{suffix}")
                    slide_images = pptx_to_images(tmp_path, max_slides=16)
                    if slide_images:
                        collages = create_collages(slide_images)
                        labels = [
                            f"Reference slides {j * 4 + 1}-{min(j * 4 + 4, len(slide_images))}"
                            for j in range(len(collages))
                        ]
                        # Use detail="low" for collages to save tokens (~85 tokens each)
                        visual_parts = images_to_base64_messages(collages, labels=labels, detail="low")
                        all_visual_parts.extend(visual_parts)
                        logger.info("reference_visual_collages_created", key=key, slides=len(slide_images), collages=len(collages))
                    import os
                    os.unlink(tmp_path)
                except Exception as ve:
                    logger.warn("reference_visual_extraction_failed", key=key, error=str(ve))

            progress = 0.15 + (0.05 * (i + 1) / len(ref_keys))
            await publisher.publish(
                "process_references",
                progress,
                f"Processed reference {i + 1}/{len(ref_keys)}",
            )
        except Exception as e:
            logger.error("reference_extraction_failed", key=key, error=str(e))

    combined = "\n\n---\n\n".join(all_texts)
    await publisher.close()
    return {"reference_context": combined, "reference_visual_parts": all_visual_parts, "current_phase": "process_references"}


async def query_generator(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    await publisher.publish("researching", 0.2, "Generating research queries...")

    # Use the FAST model for both enhancement and query generation. These are
    # utility steps where a flash-class model is just as good as Pro and
    # ~5x faster. Was 44-58s on Pro → ~5-10s on Flash.
    llm = _get_fast_llm(state, temperature=0.3, max_tokens=2048)

    raw_prompt = state.get("user_prompt", "")
    audience = state.get("audience_type", "general")
    num_slides = state.get("num_slides", 10)
    ref_context = state.get("reference_context", "")

    # Step 1: Enhance the user's prompt — but skip it when the prompt is
    # already long/detailed (>500 chars). Enhancement is meant to fill in
    # a vague one-liner; running it over a 2,000-char structured brief just
    # wastes 5-15s without improving the output.
    if len(raw_prompt) > 500:
        logger.info("prompt_enhancement_skipped", reason="long_prompt", chars=len(raw_prompt))
        prompt = raw_prompt
    else:
        try:
            enhance_result = await llm.ainvoke([
                SystemMessage(content=(
                    "You are a presentation strategist. The user gave a rough prompt for a slide deck. "
                    "Your job is to ENHANCE it into a detailed, well-structured presentation brief. "
                    "Add: specific sub-topics to cover, what data/metrics would strengthen each point, "
                    "what visual formats would work best (tables, charts, diagrams, comparisons), "
                    "and what the key takeaway should be.\n"
                    "Return ONLY the enhanced prompt text (2-3 paragraphs). Do not add meta-commentary."
                )),
                HumanMessage(content=(
                    f"Original prompt: {raw_prompt}\n"
                    f"Audience: {audience}\n"
                    f"Number of slides: {num_slides}\n"
                    "Enhance this into a detailed presentation brief."
                )),
            ])
            prompt = enhance_result.content if hasattr(enhance_result, "content") else raw_prompt
            logger.info("prompt_enhanced", original_len=len(raw_prompt), enhanced_len=len(prompt))
        except Exception as e:
            logger.warning("prompt_enhancement_failed", error=str(e))
            prompt = raw_prompt

    await publisher.publish("researching", 0.25, "Generating research queries...")

    # Step 2: Generate research queries from the enhanced prompt
    structured_llm = llm.with_structured_output(ResearchQueries)

    messages = [
        SystemMessage(content=(
            "You are a research query generator for presentation creation. "
            "Generate 6-8 targeted web search queries that will find relevant, "
            "up-to-date information for the presentation topic. "
            "Include queries for: specific statistics/metrics, industry benchmarks, "
            "case studies, expert opinions, comparison data, and recent trends. "
            "Make queries SPECIFIC — not generic like 'microservices benefits' but "
            "'microservices migration MTTR reduction statistics 2024 2025'."
        )),
        HumanMessage(content=(
            f"Enhanced topic brief:\n{prompt}\n\n"
            f"Audience: {audience}\n"
            f"Number of slides: {num_slides}\n"
            f"Reference context (if any): {ref_context[:2000]}\n\n"
            "Generate 6-8 specific, data-focused search queries."
        )),
    ]

    try:
        result = await structured_llm.ainvoke(messages)
        queries = result.queries if hasattr(result, "queries") else []
    except Exception:
        # Fallback: raw LLM call + parse
        raw_llm = _get_llm(state, temperature=0.3)
        raw_result = await raw_llm.ainvoke(messages)
        raw_text = raw_result.content if hasattr(raw_result, "content") else str(raw_result)
        parsed = _parse_json_array(raw_text)
        queries = parsed if isinstance(parsed, list) and all(isinstance(q, str) for q in parsed) else [q.get("query", str(q)) if isinstance(q, dict) else str(q) for q in parsed]

    await publisher.publish("researching", 0.3, f"Generated {len(queries)} research queries")
    await publisher.close()
    return {"research_queries": queries, "current_phase": "researching"}


async def single_search(query: str) -> list[dict]:
    # Tavily caps queries at 400 chars; if we exceed it the whole search
    # phase fails silently and the deck content suffers. Clip aggressively
    # while preserving the most-informative leading tokens.
    if len(query) > 380:
        query = query[:380].rsplit(" ", 1)[0]
    try:
        client = AsyncTavilyClient(api_key=settings.tavily_api_key)
        response = await client.search(query, max_results=5)
        results: list[dict] = []
        for r in response.get("results", []):
            results.append({
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "relevance": r.get("score", 0.5),
            })
        return results
    except Exception as e:
        logger.error("search_failed", query=query, error=str(e))
        return []


async def parallel_search(state: PPTGenerationState) -> dict:
    """Two-phase research: initial search + follow-up for stats and data."""
    publisher = _get_publisher(state)
    queries = state.get("research_queries", [])
    prompt = state.get("user_prompt", "")
    await publisher.publish("researching", 0.33, f"Phase 1: Searching {len(queries)} queries...")

    # Phase 1: Initial broad search
    tasks = [single_search(q) for q in queries]
    all_results = await asyncio.gather(*tasks)

    flat_results: list[dict] = []
    for result_list in all_results:
        flat_results.extend(result_list)

    await publisher.publish("researching", 0.38, f"Phase 1 done: {len(flat_results)} results. Running follow-up searches for stats...")

    # Phase 2: Follow-up searches specifically for statistics and data points
    stat_queries = [
        f"{prompt} statistics data numbers metrics",
        f"{prompt} before after improvement results ROI",
        f"{prompt} industry benchmark comparison",
    ]

    stat_tasks = [single_search(q) for q in stat_queries]
    stat_results = await asyncio.gather(*stat_tasks)

    for result_list in stat_results:
        flat_results.extend(result_list)

    await publisher.publish("researching", 0.45, f"Research complete: {len(flat_results)} total results (including stats)")
    await publisher.close()
    return {"research_results": flat_results, "current_phase": "researching"}


async def synthesizer(state: PPTGenerationState) -> dict:
    """Deep research synthesis — extracts structured content blocks for slides.

    Instead of a generic summary, this produces:
    - Key statistics with numbers (for stat callout slides)
    - Before/after comparisons (for comparison slides)
    - Process steps (for flow diagram slides)
    - Key insights with supporting evidence (for content slides)
    - Industry benchmarks and trends (for chart slides)
    """
    publisher = _get_publisher(state)
    await publisher.publish("synthesizing", 0.5, "Deep research synthesis — extracting structured content...")

    # Synthesis structures research into stat/compare/flow lines — a fast
    # model is fine here. Was 32-36s on Pro → ~6-10s on Flash.
    llm = _get_fast_llm(state, temperature=0.4, max_tokens=8000)
    research = state.get("research_results", [])
    ref_context = state.get("reference_context", "")
    prompt = state.get("user_prompt", "")
    num_slides = state.get("num_slides", 5)
    audience = state.get("audience_type", "general")

    research_text = "\n\n".join(
        f"Source: {r.get('url', 'N/A')}\n{r.get('content', '')}"
        for r in research[:20]
    )

    messages = [
        SystemMessage(content=(
            "You are a research analyst preparing content for a presentation. "
            "Your job is NOT to summarize — it's to extract SPECIFIC, STRUCTURED content blocks "
            "that can be directly placed on presentation slides.\n\n"
            "For each major theme you find, extract:\n\n"
            "1. **KEY STATISTICS**: Exact numbers, percentages, metrics. "
            "Format: 'STAT: [number] — [what it means]'\n"
            "Example: 'STAT: 70% — of alerts are noise/duplicates that waste SRE time'\n\n"
            "2. **BEFORE/AFTER COMPARISONS**: How things change with the solution. "
            "Format: 'COMPARE: Before: [old way] → After: [new way]'\n"
            "Example: 'COMPARE: Before: MTTR 4+ hours → After: MTTR 15 minutes (90% reduction)'\n\n"
            "3. **PROCESS STEPS**: Sequential steps in a workflow. "
            "Format: 'FLOW: Step 1: [action] → Step 2: [action] → ...'\n\n"
            "4. **KEY INSIGHTS**: Important findings with evidence. "
            "Format: 'INSIGHT: [finding] — Evidence: [source/data]'\n\n"
            "5. **PAIN POINTS**: Problems the audience faces. "
            "Format: 'PAIN: [problem] — Impact: [consequence]'\n\n"
            "6. **SOLUTION BENEFITS**: How the solution helps. "
            "Format: 'BENEFIT: [capability] — Result: [outcome]'\n\n"
            f"Target audience: {audience}. Extract content appropriate for this audience.\n"
            f"This presentation needs {num_slides} slides, so extract enough content for that."
        )),
        HumanMessage(content=(
            f"Presentation topic: {prompt}\n\n"
            f"Research findings:\n{research_text}\n\n"
            f"Reference materials:\n{ref_context[:3000]}\n\n"
            f"Extract structured content blocks for {num_slides} slides. "
            "Include AT LEAST 5 statistics with real numbers, 3 before/after comparisons, "
            "and 1 process flow. Be SPECIFIC — no vague claims."
        )),
    ]

    result = await llm.ainvoke(messages)
    summary = result.content if hasattr(result, "content") else str(result)

    logger.info("deep_synthesis_complete", content_length=len(summary))
    await publisher.publish("synthesizing", 0.55, "Deep research synthesis complete")
    await publisher.close()
    return {"research_summary": summary, "current_phase": "synthesizing"}


async def content_planner(state: PPTGenerationState) -> dict:
    publisher = _get_publisher(state)
    audience = state.get("audience_type", "general")
    is_creative = state.get("creative_mode", False)
    mode_label = " (Creative Mode)" if is_creative else ""
    await publisher.publish("planning", 0.6, f"Planning {audience} slide outline{mode_label}...")

    llm = _get_llm(state, temperature=0.3)
    structured_llm = llm.with_structured_output(OutlineOutput)

    summary = state.get("research_summary", "")
    prompt = state.get("user_prompt", "")
    audience = state.get("audience_type", "general")
    num_slides = state.get("num_slides", 10)
    style_guide = state.get("style_guide", "")
    layout_patterns = state.get("layout_patterns", [])

    # Build style-aware system prompt
    style_context = ""
    if style_guide:
        style_context = (
            "\n\n## IMPORTANT: Style Profile\n"
            "The user has selected a style profile. You MUST match this style:\n"
            f"{style_guide}\n\n"
            "Match the content density, layout preferences, and design language described above. "
        )

    layout_hint = ""
    if layout_patterns:
        preferred = [lp.get("layout_type", "") for lp in layout_patterns[:3]]
        layout_hint = f"Preferred layout types (in order of frequency): {', '.join(preferred)}. "

    # Inject knowledge graph context
    kg_context = _get_knowledge_graph_context(state)
    kg_section = f"\n\n## User's Design Preferences (from knowledge graph)\n{kg_context}" if kg_context else ""

    # Inject per-project memory (prior outlines, decisions, entities, narrative).
    # This is the single biggest lever for cross-turn coherence — the agent now
    # knows what was discussed/generated/edited earlier in this project.
    project_memory = _get_project_memory_context(state)
    memory_section = (
        f"\n\n## Project Memory (read this before planning)\n{project_memory}\n\n"
        "Use the memory above to stay consistent with prior decks for this project: "
        "don't repeat material the user has already seen, honor decisions already made, "
        "and keep recurring entities front and center."
        if project_memory else ""
    )

    messages = [
        SystemMessage(content=(
            "You are a presentation content planner. Create a slide outline using "
            "the STRUCTURED RESEARCH CONTENT below. The research contains:\n"
            "- STAT: lines — use these as stat callout content\n"
            "- COMPARE: lines — use these for before/after comparison slides\n"
            "- FLOW: lines — use these for process flow slides\n"
            "- INSIGHT: lines — use these as key talking points\n"
            "- PAIN: lines — use these to show problems\n"
            "- BENEFIT: lines — use these to show solutions\n\n"
            "For each slide, provide:\n"
            "- title: Compelling, specific (not generic)\n"
            "- layout: title, content, two_column, chart, or image_focus\n"
            "- key_points: 3-5 SPECIFIC points using data from the research. Include real numbers.\n"
            "- notes: What the presenter should say\n\n"
            "Layout selection guide:\n"
            "- 'two_column' for before/after comparisons or contrasting ideas\n"
            "- 'chart' when you have stat data to visualize\n"
            "- 'content' for process flows, insights, or detailed points\n"
            "- 'title' only for the opening slide\n"
            "- 'image_focus' for architecture or diagram slides\n\n"
            f"{layout_hint}"
            + {
                "executive": "Target audience: EXECUTIVE. Focus outline on business impact, ROI, strategic positioning, and decision-enabling metrics. Less 'how', more 'why' and 'so what'.\n",
                "technical": "Target audience: TECHNICAL. Focus outline on architecture, implementation details, system design, integration points, and performance benchmarks.\n",
                "general": "Target audience: GENERAL. Focus outline on clear explanations, relatable analogies, and balanced business + technical content.\n",
            }.get(audience, f"Target audience: {audience}.\n")
            + f"{style_context}"
            f"{kg_section}"
            f"{memory_section}"
        )),
    ]

    # Build the human message — add visual context if available
    human_text = (
        f"Topic: {prompt}\n"
        f"Number of slides: {num_slides}\n"
        f"Audience: {audience}\n\n"
        f"STRUCTURED RESEARCH CONTENT:\n{summary[:5000]}\n\n"
        f"Create an outline with exactly {num_slides} slides. "
        "USE THE SPECIFIC DATA from the research — include real numbers, stats, and comparisons. "
        "Don't make generic points when you have specific data available."
    )

    visual_parts = _build_visual_context(state)
    if visual_parts:
        # Multimodal message: text + images
        content_parts: list = [{"type": "text", "text": human_text}]
        content_parts.extend(visual_parts)
        content_parts.append({"type": "text", "text": "\nUse the visual layout patterns from these reference images to inform your outline structure."})
        messages.append(HumanMessage(content=content_parts))
    else:
        messages.append(HumanMessage(content=human_text))

    try:
        result = await structured_llm.ainvoke(messages)
        outline_items = result.outline if hasattr(result, "outline") else []
        outline_dicts = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in outline_items]
    except Exception as parse_err:
        # Fallback: call LLM without structured output and parse JSON manually
        logger.warn("structured_output_failed_for_outline", error=str(parse_err))
        raw_llm = _get_llm(state, temperature=0.3)
        messages[-1] = HumanMessage(content=messages[-1].content + "\n\nRespond with a JSON array of objects, each with: title, layout, key_points (array of strings), notes.")
        raw_result = await raw_llm.ainvoke(messages)
        raw_text = raw_result.content if hasattr(raw_result, "content") else str(raw_result)
        outline_dicts = _parse_json_array(raw_text)

    await publisher.publish(
        "outline_ready",
        0.65,
        f"Outline ready with {len(outline_dicts)} slides",
        data={"outline": outline_dicts},
    )
    await publisher.close()
    return {"outline": outline_dicts, "current_phase": "outline_ready"}


async def outline_review(state: PPTGenerationState) -> dict:
    from langgraph.types import interrupt

    publisher = _get_publisher(state)
    await publisher.publish(
        "awaiting_review",
        0.65,
        "Waiting for user approval of outline...",
        data={"outline": state.get("outline", [])},
    )
    await publisher.close()

    review_result = interrupt({"outline": state.get("outline", [])})

    approved = review_result.get("approved", False)
    edits = review_result.get("edits", [])
    feedback = review_result.get("feedback", "")

    if not approved:
        return {
            "error": feedback or "Outline rejected by user",
            "current_phase": "rejected",
        }

    if edits:
        return {
            "outline": edits,
            "user_approved": True,
            "user_edits": edits,
            "current_phase": "outline_approved",
        }

    return {
        "user_approved": True,
        "current_phase": "outline_approved",
    }


PPTXGENJS_API_REFERENCE = """
## pptxgenjs Reference — full shape & chart vocabulary

Slide: 13.33" x 7.5" (LAYOUT_WIDE). Colors: 6-char hex WITHOUT '#'. `slide` and
`pres` are already in scope — never call `pres.addSlide()` yourself.

### Backgrounds  (ONLY these two forms — anything else crashes pptxgenjs)
slide.background = { color: "HEX" };          // solid color (most common)
slide.background = { path: "https://..." };   // image background
// DO NOT write `slide.background = { fill: { ... } }` — pptxgenjs has a bug
// where it assigns the whole fill object onto .color and the renderer dies.

### Text
slide.addText("text", { x, y, w, h, fontSize, fontFace, color, bold, italic,
    align: "left"|"center"|"right", valign: "top"|"middle"|"bottom",
    charSpacing, lineSpacingMultiple, fit: "shrink"|"resize", autoFit, paraSpaceAfter });
// Multi-run rich text:
slide.addText([
  { text: "Eyebrow", options: { color: "Vivid", bold: true, fontSize: 10, charSpacing: 2, breakLine: true } },
  { text: "Big claim", options: { color: "Ink", bold: true, fontSize: 36, breakLine: true } },
  { text: "Supporting line", options: { color: "555555", fontSize: 14 } },
], { x, y, w, h });
// Bullets:
slide.addText([{ text: "Item", options: { bullet: { type: "bullet" }, breakLine: true } }], { x, y, w, h });

### Shapes — `pres.shapes.<NAME>` (use any of these by NAME)
RECTANGLE, ROUNDED_RECTANGLE, OVAL, LINE, TRIANGLE (= ISOSCELES_TRIANGLE),
RIGHT_TRIANGLE, DIAMOND, PARALLELOGRAM, TRAPEZOID, NON_ISOSCELES_TRAPEZOID,
PENTAGON (house shape — useful for "next" steps), REGULAR_PENTAGON,
HEXAGON, HEPTAGON, OCTAGON, DECAGON, DODECAGON,
CHEVRON, RIGHT_ARROW, LEFT_ARROW, UP_ARROW, DOWN_ARROW, LEFT_RIGHT_ARROW,
NOTCHED_RIGHT_ARROW, STRIPED_RIGHT_ARROW, BENT_ARROW, U_TURN_ARROW,
CIRCULAR_ARROW, CURVED_RIGHT_ARROW, CURVED_DOWN_ARROW, SWOOSH_ARROW, QUAD_ARROW,
HEART, STAR_4_POINT, STAR_5_POINT, STAR_6_POINT, STAR_8_POINT, STAR_12_POINT,
SUN, MOON, CLOUD, LIGHTNING_BOLT, TEAR, PLAQUE, FRAME, HALF_FRAME, BEVEL,
CAN, CUBE, DONUT, BLOCK_ARC, ARC, PIE_WEDGE, FUNNEL, GEAR_6, GEAR_9, WAVE,
DOUBLE_WAVE, DOWN_RIBBON, UP_RIBBON, LEFT_RIGHT_RIBBON, EXPLOSION1, FOLDED_CORNER,
DIAGONAL_STRIPE, CORNER, CORNER_TABS, CHORD,
RECTANGULAR_CALLOUT, ROUNDED_RECTANGULAR_CALLOUT, OVAL_CALLOUT, CLOUD_CALLOUT,
LINE_CALLOUT_1, LINE_CALLOUT_2, LINE_CALLOUT_1_ACCENT_BAR,
FLOWCHART_PROCESS, FLOWCHART_DECISION, FLOWCHART_CONNECTOR, FLOWCHART_TERMINATOR,
FLOWCHART_DOCUMENT, FLOWCHART_DATA, FLOWCHART_PREDEFINED_PROCESS,
FLOWCHART_MANUAL_INPUT, FLOWCHART_MERGE, FLOWCHART_ALTERNATE_PROCESS

### Shape options — fill, line, gradient, shadow, rotation
slide.addShape(pres.shapes.HEXAGON, {
  x, y, w, h,
  fill: { color: "0F62FE", transparency: 10 },        // 0=opaque, 100=transparent
  line: { color: "161616", width: 1.25, dashType: "solid"|"dash"|"dot" },
  rectRadius: 0.1,                                     // ROUNDED_RECTANGLE only
  rotate: 30,                                          // degrees
  shadow: { type: "outer", color: "000000", opacity: 0.25, blur: 8, offset: 4, angle: 45 },
  flipH: true, flipV: false,
});
// Gradient fill: pptxgenjs accepts a fill with multiple colors via "type":"gradient"
// (best supported via two-color shapes layered with transparency).

### Table — beautiful, alternating, accented
const headerOpts = { fill: { color: "0F62FE" }, color: "FFFFFF", bold: true, fontSize: 11, align: "center", valign: "middle" };
const cellOpts   = { fontSize: 11, color: "161616", valign: "middle" };
const rowEven    = { fill: { color: "F4F4F4" } };
slide.addTable([
  [ { text: "Metric", options: headerOpts }, { text: "Q3", options: headerOpts }, { text: "Q4", options: headerOpts } ],
  [ { text: "Revenue", options: { ...cellOpts, ...rowEven, bold: true } }, { text: "$12.4M", options: { ...cellOpts, ...rowEven } }, { text: "$15.1M", options: { ...cellOpts, ...rowEven } } ],
  [ { text: "Margin",  options: cellOpts }, { text: "32%",    options: cellOpts }, { text: "38%",    options: cellOpts } ],
], { x, y, w, colW: [4, 4, 4], autoPage: false, border: { pt: 0.5, color: "E5E7EB" }, fontSize: 11 });

### Charts — `pres.charts.<TYPE>`
Available types: BAR, LINE, PIE, DOUGHNUT, AREA, RADAR, SCATTER, BUBBLE, BAR3D
slide.addChart(pres.charts.BAR, [
  { name: "FY24", labels: ["Q1","Q2","Q3","Q4"], values: [3.1, 4.2, 5.0, 6.3] },
  { name: "FY25", labels: ["Q1","Q2","Q3","Q4"], values: [4.8, 5.9, 7.1, 8.4] },
], {
  x, y, w, h,
  chartColors: ["0F62FE", "DA1E28"],
  showLegend: true, legendPos: "b", legendFontSize: 10,
  showValue: true, dataLabelFontSize: 9,
  catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
  catAxisTitle: "Quarter", catAxisTitleFontSize: 10, showCatAxisTitle: true,
  valAxisTitle: "Revenue ($M)", valAxisTitleFontSize: 10, showValAxisTitle: true,
  catGridLine: { style: "none" },
  valGridLine: { style: "solid", size: 0.5, color: "E5E7EB" },
  barDir: "col", barGapWidthPct: 60,
});

### Images
slide.addImage({ path: "https://...", x, y, w, h, sizing: { type: "contain", w, h } });

### Layout grid (treat the slide as a 12-column grid with 0.5" outer margin)
Outer margin: x in [0.5, 12.83], y in [0.3, 7.2]
Header band:  y: 0.3 → 1.2 (eyebrow + title)
Content band: y: 1.3 → 6.7 (the visual)
Footer band:  y: 6.8 → 7.2 (caption / page no.)

2-col: [x:0.5  w:6.0] [x:6.83 w:6.0]
3-col: [x:0.5  w:3.9] [x:4.7  w:3.9] [x:8.93 w:3.9]
4-col: [x:0.5  w:2.85][x:3.6  w:2.85][x:6.7  w:2.85][x:9.8 w:2.85]

### Hard rules (any violation is a defect)
- No '#' in hex colors.  Always 6 chars.
- Fresh `{}` literal per addText / addShape / addTable / addChart / addImage call.
- Every element fits inside [0, 13.33] x [0, 7.5].
- Text inside a card: text.x >= card.x + 0.18 AND text.x + text.w <= card.x + card.w - 0.18.
- Tables: set explicit colW that sums to <= the table w.
- Never overlap two opaque shapes occupying the same x,y,w,h footprint.

### COLOR HANDLING RULES — strict, violations crash the renderer
- `color` is ALWAYS a 6-char hex string. Nothing else. No objects, no arrays, no numbers.
- `transparency` is ONLY valid INSIDE a shape's `fill: { color: "...", transparency: N }`.
  • Do NOT put `transparency` at the root of `addText` options.
  • Do NOT put `transparency` at the root of `addShape` options — only inside `fill`.
  • For text, use a lighter hex code instead (e.g. instead of "color: '0F62FE', transparency: 70",
    pick a tint like 'A8C2FF' that visually matches the desired faded primary).
- `chartColors` must be a plain array of 6-char hex strings: ["0F62FE", "10B981", ...].
- Table cell `fill` is `{ color: "HEX" }` only. Never an object with extra keys.
- Border on a table is `{ pt: number, color: "HEX" }` — nothing else.
- For dim/ghost numerals (e.g. "01" behind a card), use a soft tint hex
  (CBD5E1, E5E7EB, F1F5F9) — DO NOT use transparency on text.

### SVG-as-image — your gradient and 3D escape hatch
pptxgenjs cannot do gradient fills, perspective tilts, glass/glow effects,
hot-spot lighting, or rotated parallelograms with rounded corners natively.
For ONE or TWO showpiece visuals per deck (cover hero, the marquee diagram,
a stunning section divider), drop down to SVG. Native shapes still rule for
text, tables, charts, KPI cards, and standard diagrams — the SVG escape is
for the centerpiece visual that has to look art-directed.

A helper `embedSvg(svgString, { x, y, w, h, rotate?, transparency? })` is in
scope. You write SVG as a normal string; it handles base64 + data-URI for you.

When SVG earns its place:
  • Multi-stop gradients (vivid hero card with green→blue→purple→red).
  • Radial "hot spot" lighting in a corner of a card.
  • Glass/shimmer overlay (low-opacity white linear gradient).
  • Concentric arc decoratives behind content (depth without clutter).
  • Stacked perspective parallelogram cards (rotated rounded rectangles).
  • Anything that needs `filter`, `mask`, or `gradientTransform`.

Do NOT replace the entire slide with one giant SVG — text inside SVG is not
editable in PowerPoint. Compose: SVG as the visual layer, native pptxgenjs
addText / addTable / addChart on TOP for editable copy.

#### The geometry insight (use it everywhere)
Complex shapes are usually simple shapes with a transform. A parallelogram
is a rotated rectangle. A 3D-stacked deck is rotated rounded rectangles at
regular x/y offsets. Reverse-engineer the tilt with arctan, then use SVG's
`transform="translate(cx, cy) rotate(θ)"` and draw a normal rect centered
at origin — you get rounded corners and proper geometry for free.

Example pattern (rotated gradient card with hot-spot, 11.65° tilt):
```
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560">
  <defs>
    <linearGradient id="g0" x1="0" x2="640" y1="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#4A9B6C"/>
      <stop offset="40%"  stop-color="#3060C8"/>
      <stop offset="75%"  stop-color="#7230B8"/>
      <stop offset="100%" stop-color="#C83850"/>
    </linearGradient>
    <radialGradient id="hot0" cx="88%" cy="18%" r="55%" gradientUnits="objectBoundingBox">
      <stop offset="0%"   stop-color="#DD2244" stop-opacity="0.88"/>
      <stop offset="60%"  stop-color="#DD2244" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#DD2244" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g transform="translate(440 138) rotate(-11.65)">
    <rect x="-320" y="-44" width="640" height="88" rx="20" ry="20" fill="url(#g0)"/>
    <rect x="-320" y="-44" width="640" height="88" rx="20" ry="20" fill="url(#hot0)"/>
  </g>
</svg>`;
embedSvg(svg, { x: 1.0, y: 1.0, w: 8.0, h: 5.6 });
slide.addText('Experience layer', { x: 2.0, y: 2.7, w: 4, h: 0.5, color: 'FFFFFF', fontSize: 16, bold: true });
```

Notes for SVG specifically:
  • Always set viewBox so the SVG scales cleanly to whatever {w, h} you pick.
  • Inside `<defs>` put gradients/filters; reference by `url(#id)`.
  • For glass shimmer: layer a second white→transparent linear gradient on top.
  • For depth: 4-8 concentric `<circle>` strokes at low opacity behind the focal element.
  • Text *inside* SVG renders but isn't editable — keep important copy on the
    pptxgenjs side via `slide.addText` over the embedded SVG.

### Gradient toolkit — ranked by control vs effort
When you need a gradient effect on a shape, pick the cheapest tool that fits:
  1. **SVG image via embedSvg** — full control, multi-stop, radial, mesh.
     Use for the centerpiece visual where the gradient HAS to be precise.
  2. **Stacked semi-transparent rectangles** — two or three overlapping
     ROUNDED_RECTANGLEs at the same x/y/w/h with `fill: { color, transparency }`
     in different palette tints. Approximates a soft 2-stop gradient with
     zero SVG. Good for accent bars, card backdrops, faded hero panels.
  3. **Background image** — if the entire slide background needs a gradient,
     bake it into one SVG and set `slide.background = { path: dataUrl }`.
  4. **Single solid + tint sibling** — when a "subtle gradient" really just
     means "solid with a slightly lighter strip on top," two solid rects
     beat a real gradient every time.

### Mental model for hard slides — apply when the slide has to dazzle
1. **Decompose first, code second.** Layer it: background → decoratives →
   primary visual → supporting text. Build in that order.
2. **Find the constraint early.** The hardest element (gradient, perspective,
   3D stack) decides your tool: native shapes → SVG → image. Choose in the
   first 30 seconds and design around it.
3. **Visual hierarchy through color.** The most important element gets the
   most saturated, multi-color treatment. Supporting elements get progressively
   muted. Don't make everything equally vivid — the eye has nowhere to land.
4. **Depth through layering.** Multiple overlapping semi-transparent elements
   at different opacities create believable depth. A glass shimmer on a card,
   a faint arc field behind a diagram, a radial glow in a corner — each adds
   1-2 % of polish; together they make the slide feel designed.
5. **Geometry as transforms.** A parallelogram is a rotated rectangle. A
   stacked 3D deck is rotated rectangles at regular offsets. Hexagonal grid
   is one hexagon translated on a 60° lattice. Recognize the transform and
   the math collapses.
6. **Precise coordinates.** The gap between "designed" and "AI slop" is whether
   things actually align. Compute centers and gaps mathematically — never
   guess. If you have 3 cards across 12.33" of usable width with 0.25" gaps,
   that's `cardW = (12.33 - 2*0.25) / 3 = 3.94`, not "looks about 4".
"""


async def slide_writer(state: PPTGenerationState) -> dict:
    """Generate pptxgenjs JavaScript code for each slide.

    Instead of abstract SlideSpec, the LLM writes the actual pptxgenjs code
    that will be executed directly by the Node worker. This gives the LLM
    full control over every visual element, color, shape, and position.
    """
    publisher = _get_publisher(state)
    is_creative = state.get("creative_mode", False)
    # Default ON: the KROKI skill is harmless when not used (the slide-writer
    # only emits a marker if it decides a diagram fits, and the prompt now
    # has explicit "when NOT to use" guidance). Defaulting to OFF was making
    # the LLM produce empty slides whenever a user asked for "a mindmap" or
    # "a sankey" — it had no way to know those existed.
    use_diagram_images = state.get("use_diagram_images", True)
    use_image_gen = state.get("use_image_gen", False)
    audience = state.get("audience_type", "general")

    mode_parts = []
    if is_creative:
        mode_parts.append("Creative Mode")
    if use_diagram_images:
        mode_parts.append("Diagram Images")
    if use_image_gen:
        mode_parts.append("AI Images")
    mode_label = " + ".join(mode_parts) if mode_parts else "Standard Mode"
    logger.info(
        "slide_writer_modes",
        creative=is_creative,
        diagrams=use_diagram_images,
        image_gen=use_image_gen,
        audience=audience,
    )
    await publisher.publish(
        "writing_slides", 0.7,
        f"Designing slides with {mode_label} for {audience} audience..."
    )

    llm = _get_llm(state, temperature=0.7 if is_creative else 0.5, max_tokens=32000 if is_creative else 16000)

    outline = state.get("outline", [])
    summary = state.get("research_summary", "")
    prompt = state.get("user_prompt", "")
    style_guide = state.get("style_guide", "")
    visual_style = state.get("visual_style", {}) or {}
    layout_patterns = state.get("layout_patterns", []) or []
    theme_config = state.get("theme_config", {}) or {}
    num_slides = state.get("num_slides", len(outline))

    outline_text = json.dumps(outline, indent=2)

    # Resolve the brand palette into a flat dict of role → hex. Both shapes are
    # supported: legacy flat (accent1/dk1/lt1) and seeded nested (colors.primary, ...).
    locked_palette: dict[str, str] = {}
    if isinstance(theme_config, dict) and theme_config:
        nested = theme_config.get("colors") if isinstance(theme_config.get("colors"), dict) else None
        if nested:
            # Seeded format — semantic role names
            for role in ("primary", "secondary", "accent1", "accent2", "accent3", "accent4",
                         "background", "surface", "text_primary", "text_muted", "text_inverse"):
                v = nested.get(role)
                if isinstance(v, str) and v:
                    locked_palette[role] = v.lstrip("#").upper()
        else:
            # Legacy flat format — OOXML keys
            for role in ("accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
                         "dk1", "lt1", "dk2", "lt2", "hlink"):
                v = theme_config.get(role) if isinstance(theme_config.get(role), str) else None
                if v:
                    locked_palette[role] = v.lstrip("#").upper()

    has_locked_palette = bool(locked_palette)
    has_style_profile = bool(style_guide or visual_style or has_locked_palette)

    # Only use knowledge graph + style when a style profile was explicitly selected
    style_section = ""
    palette_section = ""
    kg_section = ""
    if has_locked_palette:
        # Build a deterministic palette block the LLM must reuse verbatim across every slide.
        ordered_keys = [
            ("primary", "Primary — anchor of the brand; titles, header bars, primary buttons"),
            ("secondary", "Secondary — supporting structural color"),
            ("accent1", "Accent 1 — first emphasis (KPI numbers, key icon, active states)"),
            ("accent2", "Accent 2 — second emphasis, comparisons, secondary highlight"),
            ("accent3", "Accent 3 — tertiary; charts and decorative"),
            ("accent4", "Accent 4 — sparingly, for diversity in charts/grids"),
            ("background", "Background — full-slide background on light slides"),
            ("surface", "Surface — card / panel fill on light backgrounds"),
            ("text_primary", "Text Primary — body and table text on light surfaces"),
            ("text_muted", "Text Muted — captions, eyebrows, secondary copy"),
            ("text_inverse", "Text Inverse — text on dark/primary backgrounds"),
            ("dk1", "Dark 1 (legacy) — main dark"),
            ("lt1", "Light 1 (legacy) — main light"),
            ("dk2", "Dark 2 (legacy)"),
            ("lt2", "Light 2 (legacy)"),
            ("accent5", "Accent 5 (legacy)"),
            ("accent6", "Accent 6 (legacy)"),
            ("hlink", "Hyperlink (legacy)"),
        ]
        rows = []
        for k, desc in ordered_keys:
            if k in locked_palette:
                rows.append(f"  {k:<14} {locked_palette[k]}   {desc}")
        palette_block = "\n".join(rows)

        palette_section = (
            "\n\n## LOCKED BRAND PALETTE — USE THESE EXACT HEX CODES, NOTHING ELSE\n"
            "The user selected a brand style profile. Every slide in this deck must use\n"
            "ONLY the hex codes below for fills, text, lines, and chart series. Do NOT\n"
            "invent additional colors. Do NOT lighten or darken these except via\n"
            "`fill: { color, transparency: N }` (transparency is fine).\n\n"
            f"{palette_block}\n\n"
            "Application rules:\n"
            "  • Title slide background: dark variant (text_primary or accent1).\n"
            "  • Content slides: background or surface as base; text_primary for body.\n"
            "  • At most 3 brand accents per slide — pick from {primary, accent1, accent2, accent3}.\n"
            "  • Chart series colors: pull from primary + accent1..accent4 in order.\n"
            "  • Hover/active emphasis: accent1.\n"
            "  • Negative/warn signals: only use accent2 if it is reddish; otherwise reach\n"
            "    for a single muted gray (text_muted) — never invent a red.\n"
        )

    if has_style_profile:
        parts = []
        if style_guide:
            parts.append(
                "## Visual Style Guide from Brand Profile\n"
                "Treat this as a binding contract — match these patterns:\n"
                f"{style_guide[:3500]}\n"
            )
        if visual_style:
            # Keep the most useful subset short and tight.
            vs_lines = []
            for key in ("design_language", "brand_personality", "typography_treatment",
                        "typography_hierarchy", "color_usage", "color_discipline",
                        "spacing", "spacing_pattern", "info_density", "content_density",
                        "composition", "visual_hierarchy", "decoratives", "graphic_elements",
                        "photography", "icons", "chart_style"):
                v = visual_style.get(key)
                if isinstance(v, str) and v:
                    vs_lines.append(f"  • {key.replace('_', ' ').title()}: {v}")
            if vs_lines:
                parts.append("## Visual Style Attributes (from analyzed reference decks)\n" + "\n".join(vs_lines))
        if layout_patterns:
            lp_lines = []
            for lp in layout_patterns[:8]:
                if isinstance(lp, dict):
                    desc = lp.get("description") or lp.get("layout_type") or ""
                    elems = lp.get("typical_elements") or []
                    if desc:
                        elem_str = ", ".join(elems[:6]) if isinstance(elems, list) else ""
                        lp_lines.append(f"  • {desc}" + (f"  ({elem_str})" if elem_str else ""))
            if lp_lines:
                parts.append("## Layout Patterns the Source Deck Uses (mirror these)\n" + "\n".join(lp_lines))
        if parts:
            style_section = "\n\n" + "\n\n".join(parts) + "\n"

        kg_context = _get_knowledge_graph_context(state)
        if kg_context:
            kg_section = f"\n\n## User's Design Preferences\n{kg_context[:1000]}"

    # Brand logo enrichment via logo.dev — extract mentioned companies/tools
    # and fetch their logos so the LLM can place them on the slides.
    brand_logos: dict[str, str] = {}
    try:
        brand_text = f"{prompt}\n\n{outline_text}"
        brand_names = await extract_brand_mentions(brand_text, llm)
        if brand_names:
            brand_logos = await resolve_brand_logos(brand_names)
            logger.info("brand_logos_resolved", count=len(brand_logos), brands=list(brand_logos.keys()))
    except Exception as e:
        logger.warning("brand_logo_enrichment_failed", error=str(e))

    logos_section = ""
    if brand_logos:
        # Filter out the deck's own primary subject — if a brand name
        # appears verbatim in the project title or the cover slide's
        # outline title, treat it as the deck's subject and do NOT fetch
        # a logo for it (the deck's typography already establishes that
        # brand; a logo.dev fetch on a fictional/new product name returns
        # a generic placeholder that gets watermarked across every slide).
        subject_haystack = (
            (state.get("project_name") or "") + " " +
            (state.get("outline", [{}])[0].get("title", "") if state.get("outline") else "")
        ).lower()
        filtered: dict[str, str] = {}
        skipped: list[str] = []
        for name, url in brand_logos.items():
            if name.lower() in subject_haystack:
                skipped.append(name)
                continue
            filtered[name] = url
        if skipped:
            logger.info("logos_filtered_as_deck_subject", skipped=skipped)
        brand_logos = filtered

    if brand_logos:
        logos_lines = "\n".join(f'- "{name}": {url}' for name, url in brand_logos.items())
        logos_section = (
            "\n\n## AVAILABLE THIRD-PARTY BRAND LOGOS\n"
            "Logo URLs for THIRD-PARTY tools mentioned in the prompt/outline.\n"
            "Place them WITH PURPOSE, not as decoration.\n\n"
            "### WHERE TO USE LOGOS\n"
            "- One dedicated 'integrations' or 'tech stack' slide → small grid of all logos\n"
            "- Architecture diagrams → ONE logo beside each component box\n"
            "- Comparison tables → row icon, left of each row\n\n"
            "### SIZING\n"
            "- Grid: w:1.0, h:0.7 each\n"
            "- Beside a component box: w:0.5, h:0.4\n"
            "- Row icon: w:0.35, h:0.25\n\n"
            "### ❌ HARD RULES — DO NOT BREAK THESE\n"
            "- The SAME logo MUST NOT appear on more than ONE slide. Putting one\n"
            "  logo on every slide turns it into a watermark and the user has\n"
            "  explicitly flagged that as broken.\n"
            "- NO logo on the cover slide. The cover establishes the brand\n"
            "  through typography and the IMAGE_GEN photo.\n"
            "- NO logo on KPI / stat / divider slides.\n"
            "- NO logo on every footer.\n"
            "- Use EXACT URLs below — do NOT invent or guess.\n\n"
            f"Logos available:\n{logos_lines}\n"
        )

    # Diagram section — inject Kroki skill when enabled
    diagram_section = ""
    if use_diagram_images:
        diagram_section = KROKI_SKILL_REFERENCE
    else:
        diagram_section = (
            "\n\n## DIAGRAM RECIPES (shape-based — fully editable in PowerPoint)\n"
            "Build these diagrams using native pptxgenjs shapes. They are fully editable.\n\n"
            "### Sequence Diagram (2-3 actors)\n"
            "```\n"
            "// Actor boxes at top\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1, y: 0.8, w: 2, h: 0.6, fill: { color: '0F3460' } });\n"
            "slide.addText('Service A', { x: 1, y: 0.8, w: 2, h: 0.6, color: 'FFFFFF', fontSize: 12, bold: true, align: 'center', valign: 'middle' });\n"
            "// Vertical lifeline\n"
            "slide.addShape(pres.shapes.LINE, { x: 2, y: 1.4, w: 0, h: 4, line: { color: 'CCCCCC', width: 1, dashType: 'dash' } });\n"
            "// Horizontal arrow (message)\n"
            "slide.addShape(pres.shapes.LINE, { x: 2, y: 2.0, w: 4, h: 0, line: { color: '0F3460', width: 2 } });\n"
            "slide.addText('POST /api', { x: 2.5, y: 1.6, w: 3, h: 0.3, fontSize: 10, color: '0F3460' });\n"
            "```\n\n"
            "### Architecture Diagram (hub & spoke)\n"
            "```\n"
            "// Central hub\n"
            "slide.addShape(pres.shapes.OVAL, { x: 5.5, y: 2.5, w: 2.5, h: 2.5, fill: { color: '0F3460' } });\n"
            "slide.addText('Core\\nService', { x: 5.5, y: 2.5, w: 2.5, h: 2.5, color: 'FFFFFF', fontSize: 14, bold: true, align: 'center', valign: 'middle' });\n"
            "// Spoke nodes (repeat at 45° intervals)\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 1, y: 1, w: 2.2, h: 1.2, fill: { color: 'E8F4FD' }, rectRadius: 0.1 });\n"
            "slide.addText('Database', { x: 1, y: 1, w: 2.2, h: 1.2, fontSize: 11, bold: true, align: 'center', valign: 'middle', color: '0F3460' });\n"
            "// Connector line from spoke to hub\n"
            "slide.addShape(pres.shapes.LINE, { x: 3.2, y: 1.6, w: 2.3, h: 0.9, line: { color: '00B4D8', width: 2 } });\n"
            "```\n\n"
            "### Gantt / Timeline\n"
            "```\n"
            "// Horizontal time axis\n"
            "slide.addShape(pres.shapes.LINE, { x: 0.5, y: 4, w: 12, h: 0, line: { color: '333333', width: 2 } });\n"
            "// Phase bars (stacked horizontal rectangles at different y positions)\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: 2.0, w: 4, h: 0.6, fill: { color: '0F3460' }, rectRadius: 0.05 });\n"
            "slide.addText('Phase 1: Discovery', { x: 0.5, y: 2.0, w: 4, h: 0.6, color: 'FFFFFF', fontSize: 10, align: 'center', valign: 'middle' });\n"
            "slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 3.5, y: 2.8, w: 5, h: 0.6, fill: { color: '00B4D8' }, rectRadius: 0.05 });\n"
            "slide.addText('Phase 2: Build', { x: 3.5, y: 2.8, w: 5, h: 0.6, color: 'FFFFFF', fontSize: 10, align: 'center', valign: 'middle' });\n"
            "```\n"
        )

    # Build system message — keep it FOCUSED and SHORT
    # ─── THE DESIGNER PROMPT ──────────────────────────────────────────
    # Treat this LLM as a senior presentation designer at a top consulting firm
    # (think McKinsey, Pentagram, Slack's design team). Not a code generator.
    # The mindset: "I am designing a deck a CEO will present to a board. Every
    # pixel must earn its place. Every slide must close the loop on its idea."

    audience_brief = {
        "executive": (
            "EXECUTIVE AUDIENCE — C-suite, VP, Board. They have 30 seconds per slide. "
            "Lead with the BOTTOM LINE: revenue, ROI, market position, strategic risk. "
            "One big idea per slide. Use bold stat callouts (48-72pt numbers). "
            "Translate technical concepts into business outcomes. Premium aesthetic: "
            "dark backgrounds for emotional impact, generous white space, sophisticated accent colors."
        ),
        "technical": (
            "TECHNICAL AUDIENCE — engineers, architects, DevOps. They want depth and rigor. "
            "Lead with HOW IT WORKS: architecture, data flow, latency, throughput, protocols. "
            "Use diagrams, sequence flows, comparison tables with real metrics. "
            "Higher information density is welcomed. Clean, structured, no fluff. "
            "Cite actual tools (Kubernetes, Postgres, Redis) and version-specific behaviors."
        ),
        "general": (
            "GENERAL AUDIENCE — mixed roles, all-hands, external partners. They need orientation first. "
            "Lead with WHY IT MATTERS, then show how it works through analogies and visuals. "
            "Balance business and technical: define jargon inline, use journey maps and stat callouts. "
            "Modern, approachable design — vibrant accents, friendly imagery, clear hierarchy."
        ),
    }.get(audience, f"Audience: {audience}.")

    sys_parts = [
        "# YOU ARE A WORLD-CLASS PRESENTATION DESIGNER\n"
        "Not a code generator — a designer. You have spent 15 years at Pentagram, McKinsey, "
        "and the design teams of Apple, Stripe, and Linear. You know that great slides:\n"
        "  • Land ONE idea per slide, then get out of the way.\n"
        "  • Lead with the visual, not the bullet list.\n"
        "  • Use type, color, and white space as instruments — not decoration.\n"
        "  • Make data INSTANTLY scannable through structure (tables, charts, callouts).\n"
        "  • Respect the audience's time and intelligence.\n\n"
        "Your output is pptxgenjs JavaScript code that will render directly to .pptx.\n"
        "Every slide you design must be PRESENTATION-READY — no half-finished shapes, "
        "no overlapping text, no placeholder content, no boring bullet lists.\n",

        PPTXGENJS_API_REFERENCE,
    ]

    if palette_section:
        sys_parts.append(palette_section)
    if style_section:
        sys_parts.append(style_section)
    if kg_section:
        sys_parts.append(kg_section)
    # Per-project memory — prior outlines, decisions, entities, rolling
    # narrative. Cap at 1500 chars so it doesn't dominate the slide-writer
    # prompt budget (the content_planner already saw the full brief).
    project_memory = _get_project_memory_context(state)
    if project_memory:
        sys_parts.append(
            "\n\n## Project Memory\n" + project_memory[:1500] +
            "\n\nKeep this deck consistent with the above: same audience, same "
            "voice, don't re-cover ground already covered."
        )
    if logos_section:
        sys_parts.append(logos_section)
    if use_diagram_images:
        sys_parts.append(diagram_section)
    # IMAGE_GEN skill is gated by the user's `Images` toggle. When OFF,
    # the LLM is explicitly told NOT to emit IMAGE_GEN markers (rather
    # than silently leaving the skill out — that's how it was inventing
    # `addKroki` and other helpers). When ON, the LLM is encouraged to
    # use it for the cover + section dividers.
    if use_image_gen:
        sys_parts.append(IMAGE_GEN_SKILL_REFERENCE)
    else:
        sys_parts.append(
            "\n## NO AI IMAGES THIS DECK\n"
            "The user has DISABLED the AI Images toggle. You MUST NOT emit\n"
            "any `// IMAGE_GEN:` markers. Build the cover and dividers from\n"
            "native shapes only — solid brand-color full-bleed backgrounds,\n"
            "typography, accent rules, and SmartArt-style shape grids.\n"
            "Do NOT request photos. Do NOT reference IMAGE_GEN.\n"
        )
    # NB: GRADIENT_SKILL_REFERENCE is intentionally NOT injected — the LLM
    # kept misusing it (full-bleed gradients on top of photos, duplicate
    # markers, etc.). The implementation lingers so IMAGE_GEN can call
    # `_build_gradient_rects` internally for its `fade=` option.

    # ── Step 3 (color) is conditional on whether a brand palette is locked ──
    if has_locked_palette:
        step3_color = (
            "## Step 3 — Use the LOCKED BRAND PALETTE\n"
            "A palette is already locked above. Do not deviate from it. Do not\n"
            "introduce a 'Vivid' or 'Warm' that isn't listed. The user has chosen\n"
            "this brand identity and every slide must reinforce it.\n"
            "  • Title / hero slide: background = primary (or text_primary if very dark);\n"
            "    foreground text = text_inverse.\n"
            "  • Content slides: background = background; cards = surface; body = text_primary.\n"
            "  • Eyebrow + section markers: accent1.\n"
            "  • Pull-quote and stat hero numerals: primary or accent1.\n"
            "  • Chart series in this exact order: primary, accent1, accent2, accent3, accent4.\n"
            "  • Tables: header row fill = primary, header text = text_inverse, body cells\n"
            "    alternate background and surface.\n"
        )
    else:
        step3_color = (
            "## Step 3 — Color Like a Designer (TOPIC- and ORG-DRIVEN)\n"
            "You completed Step 0 already and committed to a 5-role palette.  For the rest of\n"
            "the deck use ONLY those hex codes.  No new colors.  Reference table from Step 0:\n"
            "  Ink (text on light)  /  Primary (titles, header bars)  /  Accent (KPIs, eye-anchor)\n"
            "  Surface (cards)       /  Background (slide bg)  /  Optional Warm (negatives only).\n\n"
            "Application rules:\n"
            "  • At most 3 of {Primary, Accent, Warm} per slide.\n"
            "  • Accent is reserved for what the eye should land on FIRST.\n"
            "  • Title / cover slide: Ink or Primary fill, light text.\n"
            "  • Content slides: Background as the slide fill, Surface for cards.\n"
            "  • Never use a saturated accent as a full-slide background.\n"
            "  • Body text on light = Ink; body text on dark = FFFFFF.\n"
        )

    # Step 0 only runs when there is no locked brand palette — it forces the
    # model to deliberately choose a palette from the prompt's signals before
    # touching any slide.
    if not has_locked_palette:
        step0_color_analysis = (
            "## Step 0 — Topic, Org & Use-case Color Analysis (do this BEFORE any slide)\n"
            "No brand style profile was selected.  You must derive ONE palette and lock it\n"
            "for the entire deck.  Be deliberate; do not default to navy + cyan.\n\n"
            "1. Read the user's prompt and outline. Extract:\n"
            "     a) Any company/organization names (e.g. Stripe, Notion, Salesforce, ICICI,\n"
            "        Wipro, IBM, Mastercard, Apollo, Snowflake, Anthropic, Figma, Shopify).\n"
            "     b) Any product/tool names that have iconic brand colors\n"
            "        (Slack purple, Snowflake cyan, Datadog purple, Notion gray, Stripe indigo, etc.).\n"
            "     c) The industry / use-case domain (fintech, healthtech, devtools, AI, climate,\n"
            "        consumer brand, SaaS, security, education, manufacturing, ops/SRE).\n"
            "     d) The mood the prompt asks for (premium, urgent, optimistic, technical, fun).\n\n"
            "2. Pick the palette in this order of precedence:\n"
            "     • If a single org dominates the deck, use a palette derived from that brand's\n"
            "       known visual identity (e.g. Stripe → indigo 635BFF + black + soft white;\n"
            "       IBM → blue 0F62FE + black 161616 + cool gray; ICICI → maroon A6192E + navy 0F2C59;\n"
            "       Wipro → purple 3D195B + teal 1AAEC3 + gold F8B944; Snowflake → cyan 29B5E8 + ink;\n"
            "       Notion → black + warm off-white; Salesforce → blue 00A1E0).\n"
            "     • If multiple orgs co-star, pick a NEUTRAL editorial palette (ink + premium\n"
            "       gray + ONE distinctive accent that fits the use-case mood).\n"
            "     • Otherwise pick the closest match below.\n\n"
            "Industry palette library (reach here only after step 2 above fails):\n"
            "  TECH / DEVTOOLS / SaaS         Ink 0E1116  Primary 1F6FEB  Accent 39D0D8  Surface F6F8FA\n"
            "  AI / DATA / RESEARCH           Ink 1A1335  Primary 6D28D9  Accent 22D3EE  Surface FAF7FF\n"
            "  FINANCE / BANKING / CORP       Ink 0F1B2D  Primary 0B6E4F  Accent D4AF37  Surface FAF7F0\n"
            "  HEALTHCARE / BIOTECH           Ink 1B3A4B  Primary 2A9D8F  Accent F4A261  Surface F4F1ED\n"
            "  SUSTAINABILITY / ENERGY        Ink 1B3A2B  Primary 2D6A4F  Accent F4A261  Surface F2EFE6\n"
            "  MARKETING / BRAND / CONSUMER   Ink 2B1F3D  Primary E25E5E  Accent F2B134  Surface FFF8F0\n"
            "  INCIDENT MGMT / OPS / SRE      Ink 0D1117  Primary 2563EB  Accent 10B981  Surface F1F5F9\n"
            "  EDUCATION / LEARNING           Ink 273043  Primary 4361EE  Accent F77F00  Surface FBF7F0\n"
            "  SECURITY / COMPLIANCE / RISK   Ink 1A1D29  Primary 334155  Accent C0392B  Surface F8FAFC\n"
            "  CREATIVE / DESIGN / MEDIA      Ink 1A1A2E  Primary FF6B6B  Accent FFD93D  Surface FBF6F0\n\n"
            "3. Once chosen, write the locked palette into the FIRST slide's `speaker_notes`\n"
            "   in this exact format on its own line so a human can audit it:\n"
            "     PALETTE: ink=#XXXXXX primary=#XXXXXX accent=#XXXXXX surface=#XXXXXX bg=#XXXXXX\n"
            "4. From that point on, every slide in the deck must use ONLY those hex codes.\n"
            "   Do not slip in another color halfway through.\n\n"
        )
    else:
        step0_color_analysis = ""

    enterprise_patterns = (
        "## Enterprise Marketing Deck Patterns — Use Liberally\n"
        "These are the patterns that make IBM / McKinsey / ICICI / Wipro / Mastercard\n"
        "decks look enterprise.  Mix and match — never repeat the same pattern twice in\n"
        "a row.  All coordinates assume LAYOUT_WIDE (13.33 × 7.5).\n\n"

        "**Cover (slide 1) — Section number + giant claim on dark fill**\n"
        "  • slide.background = primary (or ink) fill.\n"
        "  • Tiny eyebrow at (x:0.6, y:0.6, fontSize:10, charSpacing:3, ALL CAPS, color:accent).\n"
        "  • Hero claim at (x:0.6, y:2.4, w:11, h:2.6, fontSize:54-72, bold, color:text_inverse, ONE line if possible).\n"
        "  • Hairline divider: addShape LINE at (x:0.6, y:5.4, w:2.0, h:0, color:accent, width:2).\n"
        "  • Optional kicker line at (x:0.6, y:5.6, fontSize:14, color:text_inverse@70%).\n"
        "  • Page anchor at lower right: small numerator (e.g. '01 / 12') in mono-feel.\n\n"

        "**Section divider — Big numeral + section title**\n"
        "  • OVERSIZED ghost numeral on left: addText('01', {x:0.6, y:1.0, w:5, h:5,\n"
        "    fontSize:220, color: a soft tint hex like 'E5E7EB' or 'F1F5F9'} ) — never\n"
        "    use transparency on text; pick a faded hex instead.\n"
        "  • Section title overlapping it (x:1.5, y:3.0, fontSize:48, bold, color:ink).\n"
        "  • Subtitle paragraph in surface band on right (x:7.0, y:3.0, w:5.5).\n\n"

        "**Eyebrow + Title + 3 cards (the most-used enterprise content layout)**\n"
        "  • Header band: eyebrow (10pt accent CAPS) + title (32pt ink bold).\n"
        "  • Three cards in a 3-col grid at y:2.4 h:4.0.\n"
        "  • Each card: ROUNDED_RECTANGLE fill:surface, 0.08\" accent top bar, big numeral or icon,\n"
        "    card title (16pt bold ink), 2-3 line description (12pt text_muted).\n\n"

        "**KPI row — 4 stats across the top**\n"
        "  • Four equal cards y:1.5 h:1.8, fill:surface, with: 36pt accent bold numeral,\n"
        "    11pt CAPS label below, optional 9pt delta (+12% vs Q3).\n"
        "  • Below the KPI row: a single supporting chart (BAR or LINE) y:3.5 h:3.5.\n\n"

        "**Process flow — chevron / hexagon timeline**\n"
        "  • 5-7 CHEVRON shapes in a row, each w:2.0 h:0.9, alternating fill primary / accent1.\n"
        "    OR 5-7 HEXAGON shapes evenly spaced with thin LINE connectors and step numerals inside.\n"
        "  • Below each chevron: a 2-line caption (12pt ink) describing the step.\n\n"

        "**Hierarchy / Org diagram**\n"
        "  • Top ROUNDED_RECTANGLE at center (e.g. CEO / Vision).\n"
        "  • Three children below connected by short vertical LINE segments,\n"
        "    each child has 2-3 grandchildren as a tighter row of cards.\n"
        "  • Use accent1 for the parent fill, surface for children, hairline borders.\n\n"

        "**Pyramid / Maturity model**\n"
        "  • 4-5 stacked TRAPEZOID shapes from narrow on top to wide at bottom (or inverted).\n"
        "  • Each tier fill = primary at increasing transparency, label centered inside.\n\n"

        "**Quadrant matrix (2×2 strategic positioning)**\n"
        "  • Two crossing LINE shapes through center.\n"
        "  • Axis labels at the four ends (10pt CAPS text_muted).\n"
        "  • Place items as small ROUNDED_RECTANGLE chips with org/tool name; group color-coded by quadrant.\n\n"

        "**Pull-quote slide (testimonial / leadership voice)**\n"
        "  • Background: ink or primary.\n"
        "  • Big opening quote glyph (60pt color:accent) at (x:0.8, y:1.0).\n"
        "  • Quote body 28-32pt regular text_inverse with hard line breaks.\n"
        "  • Attribution row: small avatar circle (OVAL) + name/role/company in 12pt at lower left.\n\n"

        "**Comparison diptych (Before vs After)**\n"
        "  • Two equal columns y:1.6 h:5.0.\n"
        "  • Left card: addShape ROUNDED_RECTANGLE with fill: { color: 'F4F4F4', transparency: 0 }\n"
        "    (use a near-white tint like F4F4F4 or F1F5F9 — do NOT use transparency on text).\n"
        "  • Right card: addShape ROUNDED_RECTANGLE with fill: { color: surface_or_primary_tint }.\n"
        "  • Column headers: 'BEFORE' / 'AFTER' eyebrow style (10pt accent CAPS).\n"
        "  • Big metric in each column (e.g. 4 hr → 12 min) at 56pt; supporting bullets below.\n\n"

        "**Closing / CTA slide**\n"
        "  • Background: ink or primary.\n"
        "  • Centered 40pt 'So what' line summarizing the deck's argument.\n"
        "  • Below: a small CTA chip (ROUNDED_RECTANGLE accent fill, 14pt CAPS, white text).\n"
        "  • Optional small signature line: presenter name + email/handle in 11pt.\n\n"

        "## Native shape vocabulary you MUST use (RECTANGLE alone = boring)\n"
        "Hard rule — every content slide must include AT LEAST ONE non-rectangle\n"
        "shape (hexagon, chevron, trapezoid, pentagon, parallelogram, arrow,\n"
        "donut, callout, etc.) carrying real text inside it. Decorative empty\n"
        "shapes don't count — if you draw a hexagon, fill it with the step name.\n"
        "Decks of 5+ slides must use AT LEAST 3 different shape families\n"
        "across the deck so it doesn't visually flatline. Map content shape →\n"
        "right primitive:\n"
        "  • Sequential process (3-7 steps, short labels) → row of CHEVRON shapes,\n"
        "    each filled with step number + name + 1-line caption underneath.\n"
        "  • Lifecycle / feedback loop → 3-6 OVAL or HEXAGON nodes around a circle\n"
        "    with CIRCULAR_ARROW or curved LINE connectors. Each node holds the\n"
        "    phase title + 1-line action.\n"
        "  • Maturity model / tiers / pyramid → 3-5 stacked TRAPEZOID shapes,\n"
        "    widest at the base, each filled with tier name + 1-line description.\n"
        "  • Pillars / parallel columns → 3-5 ROUNDED_RECTANGLE columns each\n"
        "    with a HEXAGON or icon glyph at the top, then title + body text\n"
        "    inside. NEVER a 4-bullet list.\n"
        "  • Hub-and-spoke → central OVAL or HEXAGON with radiating LINE\n"
        "    connectors to 4-6 outer ROUNDED_RECTANGLE cards.\n"
        "  • Hierarchy / org-tree → top ROUNDED_RECTANGLE, vertical LINE\n"
        "    connectors, second-row ROUNDED_RECTANGLE children. Add a third row\n"
        "    when leaves exist.\n"
        "  • Timeline / roadmap → horizontal LINE spine with HEXAGON or OVAL\n"
        "    milestone markers; each marker has date above + caption below.\n"
        "  • Quadrant matrix (SWOT / 2×2) → two crossing LINE shapes through\n"
        "    center; 4 quadrant ROUNDED_RECTANGLE areas with axis labels at the\n"
        "    ends. Each quadrant filled with header + 2-3 bullets.\n"
        "  • Percentage / ratio call-out → DONUT or PIE_WEDGE filled to the\n"
        "    correct angle, with the % number centered inside.\n"
        "  • Stat annotation on a chart → RECTANGULAR_CALLOUT or\n"
        "    LINE_CALLOUT_1_ACCENT_BAR pointing at the data point that matters.\n"
        "  • 'Next step' or stage gate → PENTAGON (house plate) shape pointing\n"
        "    forward, filled with the action.\n"
        "  • Swim lane → PARALLELOGRAM for the lane label, ROUNDED_RECTANGLE\n"
        "    for the activities.\n"
        "  • Risk / incident / step-change → LIGHTNING_BOLT (small, accent\n"
        "    color) on top of the relevant card.\n"
        "  • Platform / engine / mechanism → small GEAR_6 next to the title.\n"
        "  • Feedback / U-turn / rework loop → U_TURN_ARROW or BENT_ARROW.\n"
        "  • Chevron-flow with body text under each step → row of CHEVRONs at\n"
        "    y:1.6, body cards at y:2.6 directly under each chevron.\n\n"
        "Fill-the-shape rule: every shape you draw must carry text or be a\n"
        "connector. No 'just decorative' rectangles, no empty hexagons. The\n"
        "structure exists to carry content.\n"
    )

    sys_parts.append(
        "\n# DESIGNER'S MINDSET — APPLY TO EVERY SLIDE\n\n"

        f"## Your Audience\n{audience_brief}\n\n"

        "## DECK CONSISTENCY (READ FIRST — applies to EVERY slide)\n"
        "This deck must look like a single magazine-quality artifact, not\n"
        "a stack of unrelated slides. Follow these rules on every single\n"
        "slide:\n\n"
        "1. **Full-bleed branded backgrounds, never bare white.**\n"
        "   - Cover + section dividers → photo (IMAGE_GEN when allowed)\n"
        "     OR a solid `slide.background = { color: PRIMARY }` plus a\n"
        "     decorative accent shape on one side.\n"
        "   - Content slides → solid `slide.background = { color: SURFACE }`\n"
        "     (the warm-white from the locked palette, NOT raw FFFFFF), with\n"
        "     a brand-color sidebar strip (0.5in wide on the left) OR a\n"
        "     top accent bar (0.15in tall) in PRIMARY across the slide.\n"
        "   - Never leave a slide on the default white. Every slide carries\n"
        "     at least ONE consistent branded element.\n"
        "2. **Same palette, every slide.**\n"
        "   Locked palette colors above are the ONLY hex codes you use.\n"
        "   Do not invent shades. Do not interpolate. Stick to the 5 roles.\n"
        "3. **Same type system, every slide.**\n"
        "   Title size, weight, color, position must repeat across slides.\n"
        "   Body type the same. Footer same place every slide.\n"
        "4. **Visuals everywhere, native-shape preferred.**\n"
        "   No slide is JUST a title + paragraph. Every content slide has\n"
        "   either: stat cards, a 2-3 column shape grid, a chevron flow,\n"
        "   a 2x2 matrix of cards, a SmartArt hub-and-spoke, an addChart,\n"
        "   a table, OR a Kroki diagram. Use native shapes (addShape +\n"
        "   addText) for hub-and-spoke / process / matrix — they never\n"
        "   fail to render. Reach for Kroki only for real charts (vegalite)\n"
        "   sankey-beta, gantt, or ER.\n"
        "5. **Repeat motifs.**\n"
        "   Pick ONE decorative motif (a thin accent bar, a corner triangle,\n"
        "   a circular dot, a numbered eyebrow tag) and use it on every\n"
        "   content slide so the deck feels like a system.\n\n"

        + step0_color_analysis +

        "## Step 1 — Understand the Slide's Job\n"
        "Before writing code, ask:\n"
        "  1. What is the ONE thing the audience must remember from this slide?\n"
        "  2. Is this slide making an ARGUMENT (persuade), TEACHING (inform), or COMPARING (decide)?\n"
        "  3. What's the strongest visual format for THIS specific content?\n"
        "     • Numbers & metrics → stat callouts or addChart (BAR/LINE)\n"
        "     • Side-by-side comparison → addTable with zebra striping or 2-col cards\n"
        "     • Process or flow → chevron / hexagon row OR Kroki diagram\n"
        "     • Categorization → 3-4 column card grid with colored top borders\n"
        "     • Hierarchy → trapezoid pyramid, hex grid, or org-tree\n"
        "     • Architecture → Kroki mermaid graph TD\n"
        "     • Timeline → chevron row, gantt-style horizontal bars, or hexagon timeline\n"
        "     • A single big concept → hero stat (60pt+) with supporting context\n\n"

        "## Step 2 — Plan the Layout BEFORE Writing Code\n"
        "The whole discipline of this step: DECIDE EVERYTHING BEFORE YOU CODE.\n"
        "When slides come out looking inconsistent or cramped, it's because\n"
        "layout decisions were made mid-code instead of upfront. Run these\n"
        "four sub-steps in order, then transcribe the plan into pptxgenjs.\n\n"

        "### 2a. Content inventory (do this BEFORE thinking about position)\n"
        "List EVERY text string the slide will carry: title, eyebrow, body lines,\n"
        "stat numerals, captions, axis labels, footer/page number. For each,\n"
        "tag it: HEADLINE / BODY / CAPTION / STAT-HERO / EYEBROW / META. You\n"
        "cannot place a thing if you haven't named it. Skipping this is how\n"
        "decks end up with 'Insert metric here' placeholders.\n\n"

        "### 2b. Pick ONE horizontal pattern\n"
        "Most slides fit one of these. Pick the one that matches your\n"
        "dominant visual; commit; do not blend.\n"
        "  Full-bleed     [        VISUAL         ]   (cover, pull-quote, hero stat)\n"
        "  Two-column     [ TEXT  |  VISUAL ]         (compare, before/after, pillars)\n"
        "  Left-heavy     [ TITLE+TEXT |  VISUAL  ]   (most content slides)\n"
        "  Three-column   [ A | B | C ]               (3-card grid, KPI row)\n"
        "  Stagger        [ NOTES |  CENTER  | NOTES ] (annotated diagram, layered cards)\n\n"

        "### 2c. Map the VERTICAL grid with exact inch ranges\n"
        "Reserve concrete y-ranges for each block; align elements across\n"
        "columns so they breathe together. Concrete worked example for the\n"
        "Stagger pattern (a layered-card diagram with side annotations):\n"
        "  y=0.30→1.20   header band   (eyebrow + title)\n"
        "  y=0.62→6.10   center visual (card stack image, 5.5 in tall)\n"
        "  y=1.50→2.40   left note 1   (aligns with row-1 of the visual)\n"
        "  y=2.70→3.55   left note 2   (aligns with row-2)\n"
        "  y=1.50→2.30   right note 1  (aligns with row-1, right side)\n"
        "  y=2.85→3.70   right note 2  (aligns with row-3)\n"
        "  y=4.10→4.95   right note 3  (aligns with row-4)\n"
        "  y=6.80→7.20   footer band   (page number, source)\n"
        "The pattern: side annotations are vertically anchored to specific\n"
        "rows of the central visual, so the eye connects them WITHOUT\n"
        "needing connector lines.\n\n"

        "### 2d. Lock the z-order (rendering order = layering)\n"
        "pptxgenjs renders elements in the order you call them — later\n"
        "calls appear on top. Plan the layers explicitly:\n"
        "  Layer 1: slide.background = { color }      (slide bg)\n"
        "  Layer 2: decorative shapes / accent bars   (low opacity, behind everything)\n"
        "  Layer 3: structural shapes (cards, panels) (the boxes that carry content)\n"
        "  Layer 4: gradient/SVG overlays             (only if needed for hero visual)\n"
        "  Layer 5: icons, glyphs, oversized numerals (visual accents)\n"
        "  Layer 6: body text                         (inside cards / panels)\n"
        "  Layer 7: headlines + eyebrows              (on top of any backdrop)\n"
        "  Layer 8: badges / page-number / footer     (always on top of everything else)\n"
        "If a title is being eaten by a card stack, it's because the title\n"
        "was added BEFORE the cards. Reorder, don't restyle.\n\n"

        "### Column grid reference (use these exact x/w values)\n"
        "  • 2-col: x=0.5 w=6.0  | x=6.83 w=6.0\n"
        "  • 3-col: x=0.5 w=3.9  | x=4.7 w=3.9  | x=8.93 w=3.9\n"
        "  • 4-col: x=0.5 w=2.85 | x=3.6 w=2.85 | x=6.7 w=2.85 | x=9.8 w=2.85\n"
        "  • Stagger: left notes x=0.3 w=2.1 | center x=2.55 w=8.10 | right notes x=10.85 w=2.15\n"
        "Card padding: text inside a card MUST start at card.x+0.2 and end at card.x+card.w-0.2.\n"
        "Margins: nothing within 0.3\" of another block; nothing within 0.5\" of the slide edge.\n\n"

        "### Find the HARD problem first\n"
        "Before you start coding, ask: what's the hardest thing to render on\n"
        "this slide? Gradients? Rotated parallelograms? Hot-spot lighting?\n"
        "Glass shimmer? Concentric arc field? IF the answer is one of those,\n"
        "the entire slide pivots to use the SVG escape hatch (see the\n"
        "PPTXGENJS reference's SVG-as-image section). Decide this NOW, not\n"
        "halfway through coding the slide.\n\n"

        + step3_color + "\n"

        "## Step 4 — Typography Discipline\n"
        "(Use the hex codes from the locked palette, not the labels.)\n"
        "  • Section eyebrow:  10pt, bold, ALL CAPS, charSpacing: 2, color: accent\n"
        "  • Slide title:      28-32pt, bold, color: ink — ONE line if possible\n"
        "  • Subtitle/lede:    14-16pt, regular, color: text_muted (or 555555)\n"
        "  • Body / cells:     11-12pt, color: text_primary (or 333333)\n"
        "  • Stat hero:        48-72pt, bold, color: primary or accent\n"
        "  • Stat label:       10pt, color: text_muted\n"
        "  • Caption / footer: 9pt, italic, color: 999999\n"
        "Use breakLine:true between text array items. Always set valign for vertical centering inside cards.\n\n"

        "## Step 5 — Tables Must Be Beautiful\n"
        "Boring tables ruin decks. Yours look like a McKinsey appendix:\n"
        "  • colW MUST be set proportional to content (not equal widths).\n"
        "  • Header row: bold text_inverse on primary fill, fontSize 11, align center.\n"
        "  • Data rows alternate: even = surface, odd = FFFFFF.\n"
        "  • Cell margin: [4, 8, 4, 8] (top, right, bottom, left in points).\n"
        "  • Border: thin, color E5E7EB (almost invisible).\n"
        "  • Add a 0.08\" tall accent bar 0.05\" ABOVE the table for visual lift.\n"
        "  • One concept per cell — never cram two facts into one cell.\n\n"

        "## Step 6 — Charts With Real Axes (use them — and vary the type)\n"
        "  • For any deck with 4+ slides, AT LEAST ONE slide must contain a real `addChart`.\n"
        "    Decks with 8+ slides should use 2-3 different chart types (e.g. BAR + LINE + DOUGHNUT).\n"
        "  • addChart with proper catAxisTitle, valAxisTitle, showValue: true.\n"
        "  • chartColors array length must match the data series count and pull from the palette\n"
        "    (primary, accent1, accent2, accent3 in that order).\n"
        "  • Use real numbers from the research — never make up data.\n"
        "  • catGridLine: { style: 'none' } for clean look. Hide value axis line on bar charts.\n"
        "  • Pick the right chart for the message:\n"
        "      BAR    — ranked comparisons (revenue by region, MTTR by team)\n"
        "      LINE   — time series, trends, before/after over months\n"
        "      AREA   — cumulative growth, stacked composition over time\n"
        "      DOUGHNUT — share-of-whole when slice count ≤ 5\n"
        "      RADAR  — multi-attribute capability comparisons (3-6 axes)\n"
        "      SCATTER — relationship between two metrics (cost vs reliability)\n"
        "  • Add a small RECTANGULAR_CALLOUT or LINE_CALLOUT_1 to annotate the single most\n"
        "    important data point — this turns a chart into a story.\n\n"

        + enterprise_patterns + "\n"

        "## Step 7 — The Completion Bar\n"
        "Every slide must pass these checks before you ship it:\n"
        "  ✓ Title is present and under 12 words\n"
        "  ✓ Every shape has its label INSIDE it (centered, valign:'middle')\n"
        "  ✓ Every text element fits inside its card (x, y, w, h math is correct)\n"
        "  ✓ No element extends past x=13.33 or y=7.5\n"
        "  ✓ No two elements occupy the same x,y,w,h\n"
        "  ✓ Real data from the research is used — no '[insert metric]' placeholders\n"
        "  ✓ At least one element draws the eye (a bold stat, a colored accent, an image)\n"
        "  ✓ The slide answers ONE question, not three\n"
        "  ✓ AT LEAST ONE non-rectangle shape carries content (hex, chevron,\n"
        "    trapezoid, callout, donut, arrow, etc.) — RECTANGLE-only slides fail.\n"
        "  ✓ Every shape on the slide carries text or is a connector (no empty\n"
        "    decorative shapes that exist just to fill space).\n"
        "  ✓ Every hex color is from the locked palette — no novel colors introduced.\n\n"

        "## Deck-Wide Variety Bar (across the whole deck)\n"
        "  ✓ Use AT LEAST 3 different shape families across the deck (e.g.\n"
        "    chevron + hexagon + trapezoid, or donut + parallelogram + callout).\n"
        "  ✓ Decks with 4+ slides include AT LEAST ONE addChart call.\n"
        "  ✓ Decks with 8+ slides include 2-3 different chart types\n"
        "    (mix BAR / LINE / DOUGHNUT / AREA / RADAR / SCATTER).\n"
        "  ✓ At most 2 slides in a row share the same dominant layout — break\n"
        "    monotony with a chart, a quote slide, or a chevron flow.\n\n"

        "## What NOT to Do (these are firing offenses)\n"
        "  ✗ Plain bullet list on a white slide\n"
        "  ✗ A whole slide built only from RECTANGLE / ROUNDED_RECTANGLE shapes\n"
        "  ✗ Empty decorative shapes that don't carry any text\n"
        "  ✗ Three giant colored blocks just to fill space\n"
        "  ✗ A 'Key Insights' label with no actual insight\n"
        "  ✗ Two cards with identical color and identical text styling — boring\n"
        "  ✗ Text that runs off the edge of its container\n"
        "  ✗ Footer bars that span the full width and add nothing\n"
        "  ✗ Logos floating on top of text\n"
        "  ✗ A 30pt font in a 1-inch-tall card\n"
        "  ✗ Inventing a new hex code that wasn't in the locked palette.\n\n"

        "## Pacing Across the Deck (use the slide count)\n"
        f"This deck has {num_slides} slides. Vary rhythm so it doesn't feel monotonous:\n"
        "  • Slide 1: cover — primary or ink hero with ONE bold statement, no subtitle clutter.\n"
        "  • Use a section divider before any logical group of 3+ content slides.\n"
        "  • Middle slides: alternate visual styles — table, then chart, then card grid, then chevron flow, then pull-quote.\n"
        "  • Final slide: a closing 'so what' — the takeaway, the CTA, or the next steps.\n"
        "  • If the deck has 3 or fewer slides, every slide must be DENSE with insight.\n"
        "  • If the deck has 10+ slides, use breathing room — one strong visual per slide.\n\n"

        "## The meta-principle — why every step above matters\n"
        "Decide everything before you code. Layout → constraints → shape\n"
        "strategy → z-order → palette → text content. All of that is figured\n"
        "out on paper (mentally) first; the pptxgenjs code is just\n"
        "transcription of the plan. Slides that look like 'AI slop' are\n"
        "almost always slides where layout decisions were made mid-code\n"
        "instead of upfront — the result is misaligned, inconsistent, and\n"
        "obviously cobbled together. The discipline of Steps 0-7 isn't\n"
        "bureaucracy; it's what separates a god-tier deck from generic\n"
        "output. Run them in order, every time.\n"
    )

    if is_creative:
        sys_parts.append(
            "\n# CREATIVE MODE — UNCONVENTIONAL VISUALS\n"
            "Push beyond the standard playbook. For at least 1 slide, use one of:\n"
            "  • Pyramid (stacked TRAPEZOID shapes for hierarchy/maturity models)\n"
            "  • Hub & spoke (central OVAL with radiating lines to outer cards)\n"
            "  • Quadrant matrix (2×2 with axis labels for strategic positioning)\n"
            "  • Timeline ribbon (horizontal LINE with circular milestones at intervals)\n"
            "  • Stacked progress bars (proportional widths showing breakdown of 100%)\n"
            "  • Comparison diptych (two large side-by-side cards, before/after)\n"
            "Higher temperature = more inventive layouts. But never sacrifice clarity for cleverness.\n"
        )

    sys_parts.append(
        "\n# OUTPUT FORMAT\n"
        "Return a JSON array. Each item:\n"
        "  {\n"
        "    \"slide_number\": N,\n"
        "    \"title\": \"<the actual slide title text>\",\n"
        "    \"speaker_notes\": \"<2-3 sentences a presenter would say>\",\n"
        "    \"code\": \"<pptxgenjs JavaScript code>\"\n"
        "  }\n\n"
        "In `code`:\n"
        "  • You have `slide` and `pres` already in scope. Do NOT call pres.addSlide().\n"
        "  • Hex colors are 6 chars, NO leading #. Example: '0F3460' not '#0F3460'.\n"
        "  • Create a fresh {} for every addText/addShape/addImage/addTable call.\n"
        "  • Comments inside code are fine (// like this) but keep them minimal.\n"
        "  • Output ONLY the JSON array. No prose before or after.\n"
    )

    messages = [SystemMessage(content="\n".join(sys_parts))]

    # Build human message — frame it as a designer brief
    human_text = (
        "## Designer Brief\n\n"
        f"**Deck topic:** {prompt}\n"
        f"**Slide count:** {num_slides}\n"
        f"**Audience:** {audience}\n\n"
        "## Approved Outline (use this as the slide order)\n"
        f"{outline_text}\n\n"
        "## Research Source Material (use REAL data from this — don't invent numbers)\n"
        f"{summary[:3500]}\n\n"
        "## Your Process\n"
        "For each slide, in order:\n"
        "  1. Read the outline entry for that slide. Identify the ONE idea it must convey.\n"
        "  2. Pick the best visual format (table / chart / card grid / diagram / hero stat / quadrant / etc).\n"
        "  3. Pull SPECIFIC numbers, tool names, comparisons, and quotes from the research.\n"
        "  4. Plan exact x/y/w/h on the grid — every element must fit inside the slide.\n"
        "  5. Write clean pptxgenjs code that produces a finished, polished slide.\n"
        "  6. Verify against the Step 7 completion checklist before moving to the next slide.\n\n"
        + (
            "## Diagrams\n"
            "Diagram Mode is ON. Use `// KROKI_DIAGRAM:<type>` markers ONLY for slides where a "
            "visual diagram adds genuine clarity — architecture, sequence flows, ER models, gantt charts, "
            "user journeys. Stat slides, comparison slides, and concept slides should use tables/charts/cards "
            "instead. Quality over quantity. Pick the right diagram type from the skill reference.\n\n"
            if use_diagram_images else ""
        )
        + "Now design the deck. Output ONLY the JSON array — no prose before or after."
    )

    visual_parts = _build_visual_context(state)
    if visual_parts:
        content_parts: list = [{"type": "text", "text": human_text}]
        content_parts.extend(visual_parts)
        content_parts.append({"type": "text", "text": "\nMatch the visual style, color palette, and layout structure shown in these reference images."})
        messages.append(HumanMessage(content=content_parts))
    else:
        messages.append(HumanMessage(content=human_text))

    try:
        result = await llm.ainvoke(messages)
        raw_content = result.content if hasattr(result, "content") else str(result)
        logger.info("slide_writer_llm_response", content_length=len(raw_content), first_100=raw_content[:100] if raw_content else "EMPTY")
    except Exception as e:
        logger.error("slide_writer_llm_call_failed", error=str(e))
        raise Exception(f"LLM call failed in slide_writer: {e}")

    # Parse the JSON array from the LLM response
    slide_codes = _parse_slide_codes(raw_content)

    if not slide_codes:
        logger.error("slide_writer_no_slides_parsed", raw_length=len(raw_content), raw_sample=raw_content[:500] if raw_content else "EMPTY")
        raise Exception(f"Failed to parse slide code from LLM response (length={len(raw_content)})")

    # Pre-process: the LLM sometimes embeds the KROKI_DIAGRAM marker as a
    # STRING inside `slide.addText(...)` instead of as a JS comment. It
    # also sometimes invents a non-existent helper `addKroki(slide, type,
    # source, {...})`. Rescue both by rewriting them back into proper
    # comment markers before the real KROKI scanner runs.
    slide_codes = _rescue_addkroki_calls(slide_codes)
    slide_codes = _rescue_kroki_in_addtext(slide_codes)

    # Post-process: replace KROKI_DIAGRAM markers with rendered image URLs.
    if use_diagram_images:
        slide_codes = await _process_kroki_diagrams(slide_codes, state.get("job_id", ""))

    # Post-process: replace IMAGE_GEN markers with Gemini-generated photos +
    # a brand-color tint overlay. Runs even when use_diagram_images=false —
    # image generation is a separate capability from Kroki diagrams.
    #
    # Key resolution chain:
    #   1. The currently-selected primary model's `api_key`, IF that model is
    #      a Google one (cheap reuse — same key works for image gen).
    #   2. The worker's `settings.google_api_key` (loaded from .env at boot).
    #   3. The process environment `GOOGLE_API_KEY`.
    # Without (2), users who pick Anthropic/OpenAI as their primary LLM but
    # have a Google key for image gen would silently get the flat-color
    # fallback. Logged so we can tell at a glance which fallback fired.
    model_cfg = state.get("selected_model", {})
    primary_key = model_cfg.get("api_key") or ""
    if model_cfg.get("provider") == "google" and primary_key:
        gemini_key = primary_key
        gemini_key_source = "primary_model"
    elif settings.google_api_key:
        gemini_key = settings.google_api_key
        gemini_key_source = "settings.env"
    else:
        import os as _os
        gemini_key = _os.environ.get("GOOGLE_API_KEY", "") or None
        gemini_key_source = "os.environ" if gemini_key else "none"
    logger.info("image_gen_key_resolved", source=gemini_key_source, has_key=bool(gemini_key))
    if not use_image_gen:
        # Toggle is off — strip any stray IMAGE_GEN markers the LLM
        # emitted despite the negative instruction. We don't want a half-
        # rendered photo to slip through.
        import re as _re
        stripped = 0
        for slide in slide_codes:
            code = slide.get("code", "")
            if "IMAGE_GEN" not in code:
                continue
            slide["code"] = _re.sub(r'//\s*IMAGE_GEN:.+?(?=\n|$)', '', code)
            stripped += 1
        if stripped:
            logger.info("image_gen_markers_stripped_by_toggle", slides=stripped)
    elif any("IMAGE_GEN" in (s.get("code") or "") for s in slide_codes):
        await publisher.publish("writing_slides", 0.80, "Generating hero images via Gemini…")
        slide_codes = await _process_generated_images(
            slide_codes, state.get("job_id", ""), api_key=gemini_key or None
        )

    # Post-process: expand GRADIENT markers into stacked-rect pptxgenjs code.
    # Must run AFTER image gen so fade overlays end up above the photo in
    # the z-order. Pure-Python, no network — cheap to run unconditionally.
    if any("GRADIENT:" in (s.get("code") or "") for s in slide_codes):
        slide_codes = await _process_gradient_markers(slide_codes)

    # Defensive: strip duplicate `img.logo.dev/<domain>` calls. The LLM has
    # a habit of using one logo as a watermark across multiple slides;
    # this enforces "each logo on at most one slide".
    slide_codes = _dedupe_logo_images(slide_codes)

    await publisher.publish("writing_slides", 0.85, f"Designed {len(slide_codes)} slides with full visual control")
    await publisher.close()
    return {"slides": slide_codes, "current_phase": "writing_slides"}


def _parse_json_array(raw: str) -> list[dict]:
    """Parse a JSON array from LLM output, handling markdown fences and nested objects."""
    import re
    cleaned = raw.strip()
    # Strip markdown code fences
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(1)

    # Try to parse as-is first
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            # Gemini sometimes wraps: {"outline": [...]} — extract the list
            for val in parsed.values():
                if isinstance(val, list):
                    return val
    except json.JSONDecodeError:
        pass

    # Find array brackets
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            pass

    return []


def _parse_slide_codes(raw: str) -> list[dict]:
    """Parse slide code objects from LLM output. Handles markdown code blocks
    and malformed JSON from code strings with unescaped characters."""
    import re

    # Strip markdown code fences
    cleaned = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)

    # Find the JSON array
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1:
        # Fallback: model returned a single {slide_number, title, code, ...}
        # object instead of an array. Wrap it.
        obj_start = cleaned.find("{")
        obj_end = cleaned.rfind("}")
        if obj_start != -1 and obj_end != -1 and obj_end > obj_start:
            single = cleaned[obj_start : obj_end + 1]
            try:
                parsed = json.loads(single)
                if isinstance(parsed, dict) and "code" in parsed:
                    parsed.setdefault("slide_number", 1)
                    parsed.setdefault("title", parsed.get("title", "Slide 1"))
                    parsed.setdefault("speaker_notes", parsed.get("speaker_notes", ""))
                    logger.info("slide_codes_parsed_single_object_fallback")
                    return [parsed]
            except json.JSONDecodeError:
                pass
        # Final fallback: model returned raw pptxgenjs JS in a code fence —
        # synthesize a single slide entry from it.
        js_fence = re.search(r"```(?:js|javascript)?\s*(slide\.[\s\S]*?)\s*```", raw, re.DOTALL)
        if js_fence:
            logger.info("slide_codes_parsed_js_fence_fallback")
            return [{
                "slide_number": 1,
                "title": "Slide 1",
                "speaker_notes": "",
                "code": js_fence.group(1).strip(),
            }]
        return []

    json_str = cleaned[start : end + 1]

    # Attempt 1: direct parse
    try:
        slides = json.loads(json_str)
        if isinstance(slides, list):
            return slides
    except json.JSONDecodeError:
        pass

    # Attempt 2: fix common issues — control chars in "code" string values
    try:
        # Replace literal newlines inside strings with \\n
        fixed = re.sub(
            r'"code"\s*:\s*"',
            lambda m: m.group(0),
            json_str,
        )
        slides = json.loads(fixed)
        if isinstance(slides, list):
            return slides
    except json.JSONDecodeError:
        pass

    # Attempt 3: extract individual slide objects with regex
    try:
        slide_objects = []
        # Match each {...} object containing slide_number and code
        obj_pattern = re.compile(
            r'\{\s*"slide_number"\s*:\s*(\d+)\s*,'
            r'.*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,'
            r'.*?"speaker_notes"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,'
            r'.*?"code"\s*:\s*"((?:[^"\\]|\\.)*)"'
            r'\s*\}',
            re.DOTALL,
        )
        for m in obj_pattern.finditer(json_str):
            slide_objects.append({
                "slide_number": int(m.group(1)),
                "title": m.group(2).replace('\\"', '"'),
                "speaker_notes": m.group(3).replace('\\"', '"'),
                "code": m.group(4).replace('\\"', '"').replace('\\n', '\n'),
            })
        if slide_objects:
            logger.info("slide_codes_parsed_via_regex", count=len(slide_objects))
            return slide_objects
    except Exception as e:
        logger.error("slide_code_regex_parse_error", error=str(e))

    # Attempt 4: try parsing each object individually by finding balanced braces
    try:
        slide_objects = []
        depth = 0
        obj_start = None
        for i, ch in enumerate(json_str):
            if ch == '{':
                if depth == 1:  # top-level object inside the array
                    obj_start = i
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 1 and obj_start is not None:
                    obj_str = json_str[obj_start:i + 1]
                    try:
                        obj = json.loads(obj_str)
                        if "code" in obj:
                            slide_objects.append(obj)
                    except json.JSONDecodeError:
                        # Try fixing the code field by re-escaping
                        code_match = re.search(r'"code"\s*:\s*"', obj_str)
                        if code_match:
                            # Find the last " before the closing }
                            code_start = code_match.end()
                            last_quote = obj_str.rfind('"', code_start)
                            if last_quote > code_start:
                                code_val = obj_str[code_start:last_quote]
                                # Re-escape for JSON
                                code_val = code_val.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
                                fixed_obj = obj_str[:code_start] + code_val + obj_str[last_quote:]
                                try:
                                    obj = json.loads(fixed_obj)
                                    if "code" in obj:
                                        slide_objects.append(obj)
                                except json.JSONDecodeError:
                                    pass
                    obj_start = None
        if slide_objects:
            logger.info("slide_codes_parsed_via_brace_matching", count=len(slide_objects))
            return slide_objects
    except Exception as e:
        logger.error("slide_code_brace_parse_error", error=str(e))

    logger.error("slide_code_json_parse_error", raw_sample=json_str[:500])
    return []


class ReflectionResult(BaseModel):
    """Output of the reflection agent's review."""
    overall_quality: int = Field(description="1-10 quality score")
    issues: list[str] = Field(description="List of specific issues found")
    suggestions: list[str] = Field(description="Actionable improvement suggestions")


async def reflection(state: PPTGenerationState) -> dict:
    """Reflection agent — reviews generated slides for quality and consistency.

    Checks:
    - Layout variety (no 3+ identical layouts in a row)
    - Content density matches audience type
    - Titles are compelling, not generic
    - Speaker notes are useful
    - Chart data is well-structured where present
    - Visual consistency with style profile
    - Adherence to pptx skill design guidelines

    If critical issues found and quality < 6, it revises the slides.

    Skippable: this step costs ~60s on Pro and rarely changes anything
    materially. We now skip it by default unless the job explicitly opts in
    (set `enable_reflection=true` on selected_model.options). Going forward
    the slide_writer prompt already enforces the rules reflection used to
    check post-hoc.
    """
    publisher = _get_publisher(state)
    model_cfg = state.get("selected_model", {})
    options = (model_cfg.get("options") or {}) if isinstance(model_cfg, dict) else {}
    if not options.get("enable_reflection", False):
        await publisher.publish("reflection_skipped", 0.89, "Skipping reflection (off by default).")
        logger.info("reflection_skipped_default")
        return {"current_phase": "reflection_skipped"}

    await publisher.publish("reflecting", 0.87, "Reflecting on presentation quality...")

    slides = state.get("slides", [])
    if not slides:
        await publisher.close()
        return {"current_phase": "reflection_skipped"}

    llm = _get_llm(state, temperature=0.3)
    structured_llm = llm.with_structured_output(ReflectionResult)

    outline = state.get("outline", [])
    audience = state.get("audience_type", "general")
    prompt = state.get("user_prompt", "")
    style_guide = state.get("style_guide", "")
    kg_context = _get_knowledge_graph_context(state)

    slides_json = json.dumps(slides, indent=2)

    review_context = ""
    if style_guide:
        review_context += f"\n\nStyle Profile:\n{style_guide[:1000]}"
    if kg_context:
        review_context += f"\n\nUser's Design Preferences:\n{kg_context[:1000]}"

    messages = [
        SystemMessage(content=(
            "You are a presentation quality reviewer and design critic. "
            "Review the generated slides and score them 1-10. Check for:\n\n"
            "1. LAYOUT VARIETY: Are there 3+ identical layouts in a row? Flag this.\n"
            "2. CONTENT QUALITY: Are titles compelling or generic? Are bullets informative?\n"
            "3. AUDIENCE FIT: Does content density match the target audience?\n"
            "4. SPEAKER NOTES: Are they useful for the presenter?\n"
            "5. VISUAL INTEREST: Does each slide have a visual element (chart, image, etc.)?\n"
            "6. FLOW: Do slides progress logically? Is there a clear narrative arc?\n"
            "7. DESIGN RULES: Following the design guidelines below?\n"
            f"{PPTX_DESIGN_GUIDELINES}\n"
            "If the overall quality score is below 6, provide revised_slides with fixes. "
            "If score is 6 or above, set revised_slides to null — the slides are good enough.\n"
            "Be specific in issues and suggestions."
        )),
        HumanMessage(content=(
            f"Topic: {prompt}\n"
            f"Audience: {audience}\n"
            f"Number of slides: {len(slides)}\n\n"
            f"Generated slides:\n{slides_json[:6000]}\n"
            f"{review_context}\n\n"
            "Review these slides. Score 1-10 and provide feedback."
        )),
    ]

    try:
        result = await structured_llm.ainvoke(messages)

        quality = result.overall_quality if hasattr(result, "overall_quality") else 7
        issues = result.issues if hasattr(result, "issues") else []
        suggestions = result.suggestions if hasattr(result, "suggestions") else []

        logger.info(
            "reflection_complete",
            quality=quality,
            issues_count=len(issues),
        )

        await publisher.publish(
            "reflection_done",
            0.89,
            f"Quality score: {quality}/10. {len(issues)} minor issues noted.",
            data={"quality": quality, "issues": issues, "suggestions": suggestions},
        )
        await publisher.close()
        return {"current_phase": "reflection_done"}

    except Exception as e:
        logger.warn("reflection_failed", error=str(e))
        await publisher.publish("reflection_skipped", 0.89, "Reflection skipped (non-critical)")
        await publisher.close()
        return {"current_phase": "reflection_skipped"}
