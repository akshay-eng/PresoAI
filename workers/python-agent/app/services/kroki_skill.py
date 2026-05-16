"""Kroki Diagram Skill — knowledge base for the slide generation agent.

The Kroki renderer supports many diagram types (mermaid, D2, PlantUML,
GraphViz, Vega-Lite for charts, Erd, etc.). This module teaches the
slide-writer to:

  1. RECOGNIZE when a diagram would actually help (it often won't).
  2. Pick the RIGHT type for the content.
  3. Theme it with the locked brand palette.

The slide-writer emits markers like:

    // KROKI_DIAGRAM:<type>
    // <source lines, one per JS comment>
    // END_KROKI_DIAGRAM

…and a post-processor (_process_kroki_diagrams in nodes.py) renders each
marker via Kroki and replaces it with a `slide.addImage(...)` call.
"""

KROKI_SKILL_REFERENCE = """
## DIAGRAMS — TWO MECHANISMS

There are TWO ways to put a diagram on a slide. Pick the one that fits
the content.

### 1) NATIVE SHAPE DIAGRAMS (preferred for most concept maps / flows)
Build diagrams DIRECTLY with `slide.addShape(...)` + `slide.addText(...)`
+ `slide.addShape(pres.shapes.LINE, ...)`. Looks like SmartArt, fully
editable, zero render risk. Use this for:
  - Hub-and-spoke / concept maps (center node + 4-6 radial children)
  - 3-5 step process flows (arrow chevrons or boxes + connectors)
  - Hierarchies / org charts (top-down boxes)
  - 2×2 matrices (4 quadrant boxes with a label per quadrant)
  - Comparison flows (Before → After columns)

#### Hub-and-spoke template (replaces mermaid mindmap)
```javascript
// Center hub
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.16, y: 3.25, w: 3.0, h: 1.0, fill: { color: PRIMARY }, line: { color: PRIMARY, width: 0 }, rectRadius: 0.1 });
slide.addText("Agentic AIOps", { x: 5.16, y: 3.25, w: 3.0, h: 1.0, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
// Four spokes (NW, NE, SW, SE)
const spokes = [
  { x: 0.5, y: 2.0, label: "Triage" }, { x: 9.83, y: 2.0, label: "RCA" },
  { x: 0.5, y: 4.5, label: "Remediation" }, { x: 9.83, y: 4.5, label: "Comms" },
];
spokes.forEach(s => {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: s.x, y: s.y, w: 3.0, h: 1.0, fill: { color: ACCENT }, line: { color: ACCENT, width: 0 }, rectRadius: 0.08 });
  slide.addText(s.label, { x: s.x, y: s.y, w: 3.0, h: 1.0, fontSize: 16, bold: true, color: PRIMARY, align: "center", valign: "middle" });
  slide.addShape(pres.shapes.LINE, { x: s.x + 1.5, y: s.y + 1.0, w: (5.16 + 1.5 - s.x - 1.5), h: (3.75 - s.y - 1.0), line: { color: ACCENT, width: 2 } });
});
```

#### 4-step process (replaces 4-node mermaid flowchart)
```javascript
const steps = [["Detect", "anomaly"], ["Triage", "+ rank"], ["Diagnose", "via RCA"], ["Remediate", "or page"]];
steps.forEach((s, i) => {
  const x = 0.7 + i * 3.1;
  slide.addShape(pres.shapes.CHEVRON, { x, y: 3.0, w: 3.0, h: 1.4, fill: { color: i % 2 === 0 ? PRIMARY : ACCENT }, line: { color: PRIMARY, width: 0 } });
  slide.addText(s[0], { x, y: 3.05, w: 3.0, h: 0.7, fontSize: 18, bold: true, color: "FFFFFF", align: "center" });
  slide.addText(s[1], { x, y: 3.75, w: 3.0, h: 0.6, fontSize: 12, color: "FFFFFF", align: "center" });
});
```

#### 2×2 matrix (replaces mermaid quadrantChart)
```javascript
const quads = [
  { x: 1.5, y: 2.0, color: ACCENT,  title: "Quick Wins",   items: ["Auto-rollback", "Cost detection"] },
  { x: 7.0, y: 2.0, color: PRIMARY, title: "Strategic",    items: ["Multi-region failover"] },
  { x: 1.5, y: 4.7, color: "F5F5F5", title: "Low Priority", items: ["Topology auto-discovery"] },
  { x: 7.0, y: 4.7, color: "FFCC00", title: "Resource heavy", items: ["Full self-healing"] },
];
quads.forEach(q => {
  slide.addShape(pres.shapes.RECTANGLE, { x: q.x, y: q.y, w: 5.0, h: 2.5, fill: { color: q.color }, line: { color: "DDDDDD", width: 1 } });
  slide.addText(q.title, { x: q.x + 0.2, y: q.y + 0.2, w: 4.6, h: 0.5, fontSize: 16, bold: true, color: PRIMARY });
  slide.addText(q.items.join("\\n"), { x: q.x + 0.2, y: q.y + 0.8, w: 4.6, h: 1.5, fontSize: 12, color: "1A1A2E" });
});
slide.addShape(pres.shapes.LINE, { x: 6.5, y: 2.0, w: 0, h: 5.2, line: { color: "AAAAAA", width: 1 } });
slide.addShape(pres.shapes.LINE, { x: 1.5, y: 4.6, w: 10.0, h: 0, line: { color: "AAAAAA", width: 1 } });
```

Reach for these FIRST. They never fail to render.

### 2) KROKI DIAGRAMS — for charts & flow-volume visuals only

You CAN render real diagrams via Kroki. Use one ONLY when a diagram
tells the story better than native shapes — and basically only for:
  - Real data charts → `KROKI_DIAGRAM:vegalite`
  - Flow volumes with quantities → `KROKI_DIAGRAM:mermaid` (sankey-beta)
  - Project gantt timelines → `KROKI_DIAGRAM:mermaid` (gantt)
  - True ER / class diagrams → `KROKI_DIAGRAM:erd` or `mermaid erDiagram`

For hub-and-spoke / process / matrix → use the NATIVE templates above,
NOT Kroki. Kroki mermaid `mindmap`/`quadrantChart` keep failing in the
field. Stop using them.

### When NOT to use a Kroki diagram (default — skip it):
- Cover slides, title slides, section dividers → rich text + photo background
- Stat / KPI slides → use big-number cards (addText with 36-48pt bold)
- Comparison slides → use a styled addTable with zebra striping
- Bullet-list slides → use card grids built from addShape + addText
- Single concept / definition slides → typography + accent rule
- Conclusion / call-to-action → text + button-style shape, not diagrams
- Any slide where the LLM cannot reliably emit a CORRECT diagram spec —
  prefer no diagram over a broken-looking one

### When TO use a Kroki diagram (only when applicable):
- The content describes a **multi-step PROCESS or FLOW** with 4+ stages
  → `mermaid` flowchart or `d2`
- The content shows **SYSTEM ARCHITECTURE** with components + connections
  → `d2` (modern look) or `plantuml`/`c4plantuml` for formal C4
- The content is **DATA that fits a real chart** (timeseries, distribution,
  comparison across categories) → `vegalite` ONLY (real chart, not faked)
- The content is a **TIMELINE / ROADMAP** with dated phases
  → `mermaid gantt` (for projects with dates) OR `mermaid timeline` (for
  date-less narrative phases like "2025 → IPO")
- The content is an **ER / data model** → `erd` or `mermaid erDiagram`
- The content is a **CONCEPT MAP / BRAINSTORM / TAXONOMY** (what most people
  call a "wordmap" or "mind map") → `mermaid mindmap`
- The content is a **CUSTOMER / USER JOURNEY** with steps + emotional ratings
  → `mermaid journey`
- The content is **FLOW VOLUMES between stages** (budget allocation,
  conversion funnel quantified, energy flow) → `mermaid sankey-beta`
- The content is a **2×2 STRATEGIC MATRIX** (BCG matrix, Eisenhower, risk
  vs reward, effort vs impact) → `mermaid quadrantChart`
- The content is **REQUIREMENTS + their relationships** (compliance,
  safety-critical specs) → `mermaid requirementDiagram`
- The content is a **STATE MACHINE** → `mermaid stateDiagram-v2`
- The content is **NETWORK / RACK / DATACENTER layout** → `nwdiag`,
  `rackdiag`, or `packetdiag`
- The content is a **SEQUENCE of API/message calls** → `mermaid sequenceDiagram`
  or `seqdiag` or `plantuml`

### Rule of thumb
A typical 4-slide deck might have 0–2 diagrams. A 10-slide deck might
have 2–3. NEVER have a diagram on >40% of the slides.

### Marker syntax — EXACTLY this, no exceptions:
```javascript
// KROKI_DIAGRAM:<type>
// <line 1 of source>
// <line 2 of source>
// END_KROKI_DIAGRAM
```

Every line MUST begin with `//`. The marker is a JavaScript COMMENT, not
a string or a function call.

### ❌ DO NOT INVENT HELPERS
The sandbox only exposes `slide`, `pres`, and `embedSvg`. There is NO
`addKroki(...)`, NO `renderDiagram(...)`, NO `slide.addDiagram(...)`.
Inventing these throws a ReferenceError and the rest of the slide stops
rendering, leaving an empty slide. Use ONLY the comment marker above.

### ❌ DO NOT EMBED THE MARKER IN STRINGS
`slide.addText("KROKI_DIAGRAM:mermaid\\n...")` renders the marker as
visible body copy. The marker MUST be in a `//` comment, never inside a
string passed to addText / addShape / anything else.
### Full list of supported Kroki ids (lowercase, used in the marker tag):
| id            | when to reach for it                                       |
|---------------|------------------------------------------------------------|
| `mermaid`     | flow, gantt, mindmap, timeline, sankey-beta, quadrantChart,|
|               | journey, xychart-beta, requirementDiagram, sequence, state |
| `d2`          | modern auto-layout architecture diagrams                   |
| `plantuml`    | classic UML, sequence, deployment                          |
| `c4plantuml`  | strict C4 architecture (context / container / component)   |
| `graphviz`    | precise control over node/edge appearance                  |
| `vegalite`    | REAL bar / line / area / scatter charts                    |
| `erd`         | quick ER diagrams (alternative: mermaid erDiagram)         |
| `blockdiag`   | rough block diagrams                                       |
| `seqdiag`     | sequence diagrams (alternative: mermaid sequenceDiagram)   |
| `actdiag`     | activity diagrams                                          |
| `nwdiag`      | network topology                                           |
| `packetdiag`  | packet / protocol field layout                             |
| `rackdiag`    | server rack layouts                                        |
| `nomnoml`     | hand-drawn-ish UML                                         |
| `dbml`        | database schema (cleaner than ER for SQL-ish work)         |
| `structurizr` | full software architecture model (when C4 isn't enough)    |
| `svgbob`      | ASCII-art → SVG (useful for protocol diagrams)             |
| `ditaa`       | ASCII boxes → real boxes                                   |
| `pikchr`      | small geometric diagrams                                   |
| `wavedrom`    | digital signal timing diagrams                             |
| `excalidraw`  | hand-drawn aesthetic                                       |

---

## 🎨 BRAND-COLOR THEMING — REQUIRED FOR EVERY DIAGRAM

Generic Kroki defaults look pasted-in. Every diagram MUST inject the
LOCKED brand palette via the per-type hooks below. Replace the example
hexes with the actual palette from the locked palette block above.

### Mermaid — theme variables on line 1
```
%%{init: { 'theme': 'base', 'themeVariables': {
  'primaryColor': '#1A3A6B',
  'primaryTextColor': '#FFFFFF',
  'primaryBorderColor': '#0F2A4D',
  'lineColor': '#5BC0EB',
  'tertiaryColor': '#F4B400'
}}}%%
graph LR
  A[Triage Agent] --> B[RCA Agent]
  B --> C[Remediation Agent]
```

### D2 — clean modern auto-layout. Theme via inline style blocks.
**IMPORTANT for D2**: every node label MUST be a quoted string. Don't
emit raw identifiers as labels — that's what produces "dot only" output
in production. Always shape: `NodeId: "Visible Label" { style.fill: ... }`.
```
direction: right
src: "Sources" { style.fill: "#F4B400"; style.font-color: "#000000" }
ing: "Kafka Ingest" { style.fill: "#1A3A6B"; style.font-color: "#FFFFFF" }
tri: "Triage Agent" { style.fill: "#1A3A6B"; style.font-color: "#FFFFFF" }
rca: "RCA Agent" { style.fill: "#5BC0EB"; style.font-color: "#000000" }
rem: "Remediation" { style.fill: "#E74C3C"; style.font-color: "#FFFFFF" }
src -> ing -> tri -> rca -> rem
```

### PlantUML / C4 — skinparam directives at the top
```
@startuml
skinparam backgroundColor #FFFFFF
skinparam ArrowColor #5BC0EB
skinparam rectangleBackgroundColor #1A3A6B
skinparam rectangleFontColor #FFFFFF
skinparam rectangleBorderColor #0F2A4D
rectangle "Triage Agent" as A
rectangle "RCA Agent" as B
rectangle "Remediation Agent" as C
A --> B
B --> C
@enduml
```

### GraphViz — most precise. Theme via node/edge attributes.
```
digraph G {
  rankdir=LR;
  bgcolor="transparent";
  node [shape=box, style="rounded,filled", fontname="Helvetica",
        fillcolor="#1A3A6B", fontcolor="#FFFFFF"];
  edge [color="#5BC0EB", penwidth=2];
  "Sources" -> "Ingest" -> "Triage" -> "RCA" -> "Remediate";
}
```

### Vega-Lite — REAL bar/line/area charts. Use this for any data slide.
```
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "background": "transparent",
  "config": {
    "view": { "stroke": null },
    "axis": { "labelFont": "Helvetica", "titleFont": "Helvetica",
              "labelColor": "#1A1A2E", "titleColor": "#1A1A2E",
              "domainColor": "#5A5A78", "gridColor": "#E5E7EB" }
  },
  "data": { "values": [
    {"quarter": "Q1", "value": 78},
    {"quarter": "Q2", "value": 62},
    {"quarter": "Q3", "value": 48},
    {"quarter": "Q4", "value": 31}
  ]},
  "mark": "bar",
  "encoding": {
    "x": { "field": "quarter", "type": "ordinal", "axis": { "labelAngle": 0 } },
    "y": { "field": "value",   "type": "quantitative" },
    "color": { "value": "#1A3A6B" }
  },
  "width": 700,
  "height": 320
}
```

### Mermaid mindmap — for CONCEPT MAPS / "wordmap" / TAXONOMIES.
The single best replacement when someone asks for a "wordmap" — every leaf
is a key concept, hierarchy gives weight, themes apply the brand color.
```
%%{init: { 'theme': 'base', 'themeVariables': {
  'primaryColor': '#1A3A6B', 'primaryTextColor': '#FFFFFF',
  'primaryBorderColor': '#0F2A4D', 'lineColor': '#5BC0EB'
}}}%%
mindmap
  root((Brand DNA))
    Voice
      Confident
      Pragmatic
    Tone
      Calm
      Direct
    Audience
      Engineers
      Executives
```

### Mermaid timeline — for DATE-LESS PHASES / narrative roadmaps.
Use when phases have no concrete dates (gantt is overkill). Each row is
a period; each `:` line is an event.
```
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#1A3A6B', 'cScale0': '#1A3A6B', 'cScale1': '#5BC0EB', 'cScale2': '#F4B400' } } }%%
timeline
  title Product Evolution
  2024 : Founded
       : First 10 customers
  2025 : Series A
       : Enterprise launch
  2026 : Self-serve GA
       : 100 customers
```

### Mermaid sankey-beta — for FLOW VOLUMES between stages.
Conversion funnels with real numbers, budget allocation, energy flow.
Each row: `Source,Target,Value`. Theme via per-link `linkColor` isn't
exposed yet — use the default and keep the slide background neutral.
```
sankey-beta

Leads,Qualified,1000
Qualified,Demo,420
Demo,POC,180
POC,Closed Won,65
```

### Mermaid quadrantChart — for 2×2 STRATEGIC MATRICES.
BCG / Eisenhower / impact-vs-effort. Position is `[x,y]` in [0,1].
```
%%{init: { 'theme': 'base', 'themeVariables': {
  'quadrant1Fill': '#1A3A6B', 'quadrant2Fill': '#5BC0EB',
  'quadrant3Fill': '#F4B400', 'quadrant4Fill': '#E74C3C',
  'quadrantTitleFill': '#FFFFFF', 'quadrantPointFill': '#0F2A4D'
} } }%%
quadrantChart
  title Reach vs Engagement
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 Expand
  quadrant-2 Double Down
  quadrant-3 Re-evaluate
  quadrant-4 Maintain
  Campaign A: [0.3, 0.6]
  Campaign B: [0.7, 0.8]
  Campaign C: [0.45, 0.23]
```

### Mermaid journey — for CUSTOMER / USER JOURNEYS.
Each step has an emotion score (1=😡, 5=😀) and an actor. Great for
storytelling slides showing pain points.
```
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#1A3A6B', 'lineColor': '#5BC0EB' } } }%%
journey
  title Onboarding journey
  section Sign-up
    Land on pricing: 4: User
    Create account:  3: User
  section First value
    Connect data:    2: User
    Run first query: 5: User
```

### Mermaid xychart-beta — quick inline bar/line when vegalite is overkill.
For a single data series with simple labels. Use vegalite for anything
that needs encodings, tooltips, or styling.
```
%%{init: { 'theme': 'base', 'themeVariables': { 'xyChart': { 'backgroundColor': 'transparent', 'plotColorPalette': '#1A3A6B,#5BC0EB' } } } }%%
xychart-beta
  title "Revenue by Quarter"
  x-axis [Q1, Q2, Q3, Q4]
  y-axis "USD (M)" 0 --> 60
  bar [22, 31, 45, 53]
```

### Mermaid requirementDiagram — for COMPLIANCE / SPEC SLIDES.
```
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#1A3A6B', 'lineColor': '#5BC0EB' } } }%%
requirementDiagram
  requirement encryption_at_rest {
    id: 1
    text: All PII must be encrypted at rest
    risk: high
    verifymethod: test
  }
  element db_layer {
    type: component
  }
  db_layer - satisfies -> encryption_at_rest
```

### Mermaid gantt — for ROADMAPS. Be sure to include EVERY task you describe.
```
%%{init: { 'theme': 'base', 'themeVariables': { 'primaryColor': '#1A3A6B' } } }%%
gantt
  title Migration Roadmap
  dateFormat YYYY-MM-DD
  section Foundation
  Audit               :a1, 2026-01-01, 30d
  Pilot deployment    :a2, after a1, 45d
  Connector setup     :a3, after a2, 60d
  section Expansion
  Cluster rollout     :b1, after a3, 90d
  HITL training       :b2, after b1, 30d
  Production cutover  :b3, after b2, 60d
  section Autonomy
  Auto-remediation    :c1, after b3, 60d
  Multi-region        :c2, after c1, 120d
  SRE handoff         :c3, after c2, 30d
```

---

## ⛔ HARD RULES

- **Skip the diagram** if you're not >80% confident the syntax is correct.
  A broken diagram looks worse than a content-rich slide.
- **One diagram per slide max.** If a slide already has a diagram, the
  rest of the slide is title + diagram + ≤2 lines of caption.
- **Always inject brand palette colors** via the per-type theming hooks.
- **Vega-Lite for data**, not addShape rectangles drawn to look like a chart.
- **D2 nodes need quoted string labels** — `id: "Label" { style.fill: ... }`.
- Diagrams are visually heavy — they DOMINATE a slide. Use them only when
  the content is fundamentally visual (process, architecture, chart, ER).
"""
