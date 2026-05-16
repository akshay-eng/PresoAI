/**
 * Seed the 3 default global style profiles: IBM, ICICI, Wipro.
 *
 * Each profile encodes everything the agent needs to produce a deck in that
 * house style — colors, typography, decorative tendencies, layout patterns,
 * info density, and a prose style guide. The agent decides what to put on
 * each slide; this profile tells it HOW to present it.
 *
 * Run:  pnpm tsx prisma/seed-style-profiles.ts
 */

import { PrismaClient } from "@prisma/client";

const standalonePrisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────
// IBM — Clean, technical, restrained. Authority through clarity.
// ─────────────────────────────────────────────────────────────────────
const IBM_PROFILE = {
  name: "IBM Enterprise",
  description:
    "Clean, technical, restrained. Heavy whitespace, monochromatic with a single accent. Architecture-diagram driven. Built for technical authority.",
  themeConfig: {
    colors: {
      primary: "#0F62FE",        // IBM Blue 60
      secondary: "#161616",      // IBM Gray 100 — used for headings
      accent1: "#DA1E28",        // IBM Red 60 — emphasis ONLY (e.g. "removed", "blocked")
      accent2: "#24A148",        // IBM Green 50 — success/active
      background: "#FFFFFF",
      surface: "#F4F4F4",        // IBM Gray 10 — backdrops for diagram boxes
      text_primary: "#161616",
      text_muted: "#525252",     // IBM Gray 70
      text_inverse: "#FFFFFF",
    },
    heading_font: "IBM Plex Sans",
    body_font: "IBM Plex Sans",
    mono_font: "IBM Plex Mono",   // for code, numbers, KPIs
    mood: "ibm-clean-technical",
  },
  visualStyle: {
    design_language:
      "Restraint is the signature. The deck reads like a technical paper, not a marketing pitch. Every visual element earns its place; decoration that doesn't serve the diagram is removed.",
    spacing:
      "Generous. 50%+ of every body slide should be negative space. Margins of 40-60pt around the content area.",
    typography_hierarchy:
      "Display titles in IBM Plex Sans LIGHT (300 weight) — counterintuitive but iconic. Body text in regular (400). Bold (600) only for inline emphasis. Title sizes 36-48pt; never 96pt display. Top-left aligned titles, never centered.",
    title_anchors: ["upper-left"],
    decoratives:
      "Almost none. The cover slide may use a geometric pattern of arrows or dots in pure blue at low opacity (#0F62FE @ 20%). No blobs, no oversized letters, no gradient backgrounds. The deck's visual identity comes from the IBM logo placement (bottom-left every slide) and the color discipline.",
    color_discipline:
      "Monochromatic by default — black text on white, with IBM Blue for diagram structure (lines, arrows, framing). Red is RESERVED for marking removed/blocked items only. Green for active/working. Multiple accent colors on one slide is a violation of the style.",
    photography:
      "Black-and-white or duotone (blue/black). Technical subjects only — server racks, code, abstract grids. Never decorative people-photography.",
    icons: "Carbon Design System icons. Outline style, single color (typically text_primary or primary).",
    info_density: "high",
    composition:
      "Architecture-diagram-first. Every body slide tends toward a multi-column system view with clear column labels (Data Sources / Ingestion / Storage / Analytics / Consumption). Charts are functional bar/line, never pies.",
  },
  styleGuide: `IBM enterprise style. The signature is restraint and clarity — the audience expects depth and precision, not visual flair.

TYPOGRAPHY: Use IBM Plex Sans throughout. Display titles in LIGHT weight (300) — this is iconic and counterintuitive; do not use bold display titles. Body text at 16-18pt regular. Inline bold (600) for emphasis only. Never use gradient titles, never use serif fonts.

LAYOUT: Titles are top-left aligned, always. Body slides are 50%+ whitespace. Architecture diagrams are the primary content type — multi-column layouts with column labels (Data Sources, Ingestion Layer, Storage Layer, Analytics, Consumption, AIOps), thin connecting arrows between columns, color-coded boxes (light surface for grouped backdrops, IBM Blue for primary components).

COLOR: Monochromatic discipline. Black text on white, IBM Blue (#0F62FE) for structural lines and framing. Red (#DA1E28) is reserved for marking REMOVED or BLOCKED items only — using it anywhere else breaks the style. Green (#24A148) for active/success. Two accent colors on one slide is the maximum.

DECORATION: Almost none. Cover slides may carry a pattern of small directional arrows or dots at low opacity in IBM Blue. Body slides have nothing decorative — no blobs, no oversized letters, no curve overlays. The IBM logo sits bottom-left on every slide.

CONTENT: Information-dense. Tables, paragraph notes, multi-column architecture diagrams, footnotes are all welcome. Avoid bullet-list-only slides; prefer diagrams + bullets together. KPIs in IBM Plex Mono, large size, with a single descriptor underneath.

ICONS: Carbon Design System outline icons only, single-color.

DO NOT: use gradient backgrounds, oversized decorative letters, scattered shapes, mesh gradients, smart art with curved/playful layouts, or photography that feels marketing-pitch (people smiling at cameras).`,
  layoutPatterns: [
    {
      type: "multi_column_architecture",
      frequency: 0.35,
      description: "5-6 column system architecture. Column labels at top in IBM Blue. Stacked boxes within each column (Cloud/On-Prem groupings). Thin black/blue connecting arrows between columns. Color-coded primary vs. secondary components.",
      content_density: "high",
    },
    {
      type: "title_with_bullets_or_paragraph",
      frequency: 0.20,
      description: "Top-left light-weight title + 3-7 bullet items or a short paragraph. Heavy whitespace below.",
      content_density: "medium",
    },
    {
      type: "stat_callout_row",
      frequency: 0.10,
      description: "Big numbers in IBM Plex Mono with single-line descriptors below. 3-5 stats horizontally arranged.",
      content_density: "medium",
    },
    {
      type: "data_table",
      frequency: 0.15,
      description: "Simple table with bold header row, 1pt gray dividers, no fill colors. Used for assumptions, dependencies, line items.",
      content_density: "high",
    },
    {
      type: "narrative_paragraph",
      frequency: 0.10,
      description: "Long-form text with key terms in bold-blue inline. No bullets — flowing prose.",
      content_density: "high",
    },
    {
      type: "two_column_split",
      frequency: 0.10,
      description: "Two columns: bullets left, table or list right. Used for scope/non-scope, covered/not-covered.",
      content_density: "high",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// ICICI Bank — Formal banking style. Maroon header band, dense tables, footers.
// ─────────────────────────────────────────────────────────────────────
const ICICI_PROFILE = {
  name: "ICICI Bank Corporate",
  description:
    "Formal Indian banking style. Maroon title bar on every body slide, white content area, dense tables and lists. Footer with confidentiality + page number. Built for SOW / project-doc decks.",
  themeConfig: {
    colors: {
      primary: "#A6192E",        // Maroon — the title bar color
      secondary: "#0F2C59",      // Navy — important text/numbers
      accent1: "#F37021",        // ICICI Orange — used on cover only
      accent2: "#5A5A5A",        // Charcoal gray — table dividers
      background: "#FFFFFF",
      surface: "#F0F1F2",
      text_primary: "#1A1A1A",
      text_muted: "#666666",
      text_inverse: "#FFFFFF",
    },
    heading_font: "Calibri",
    body_font: "Calibri",
    mood: "icici-corporate-banking",
  },
  visualStyle: {
    design_language:
      "Formal corporate document style. Every body slide carries the same maroon title bar at the top with the slide title in white bold. Below the bar is white content. Footer carries '© wipro confidential <slide #>' on every slide.",
    spacing:
      "Tight. Body slides are content-dense — tables, dual-column lists, multi-paragraph commentary. Margins are 24-32pt; whitespace is functional, not generous.",
    typography_hierarchy:
      "Slide titles 24-28pt bold WHITE in the maroon header bar. Body 11-14pt black. Section labels 11-12pt navy bold. Footer 8-9pt gray.",
    title_anchors: ["upper-left"],
    title_treatment:
      "Inside the maroon title bar — white text, bold, top-left aligned. The bar extends edge-to-edge of the slide.",
    decoratives:
      "None on body slides. The cover slide uses an orange/white split with a curved boundary, plus dual logos top-right (Wipro + Client). Body slides are visually flat — title bar + content + footer. No floating shapes, no gradients on body slides.",
    color_discipline:
      "Maroon is the primary identity color and lives only in the title bar. Navy for important inline data (numbers, owners). Orange ONLY on cover. Red text used sparingly for emphasis.",
    photography: "None typically. Diagrams and tables only.",
    icons: "Minimal. Simple Material/Office-style icons in primary or secondary colors when used at all.",
    info_density: "very high",
    composition:
      "Document-style. Each slide is a section of a longer report. Tables, dual-column bulleted lists, structured paragraphs. Diagrams are clean orthogonal flowcharts, not creative compositions.",
  },
  styleGuide: `ICICI Bank corporate banking style — formal, document-driven, dense.

MASTER LAYOUT: Every body slide MUST have:
1. A maroon (#A6192E) title bar across the top, ~12% of slide height, with the slide title in WHITE BOLD 24-28pt, top-left aligned within the bar.
2. White content area below.
3. A footer at the bottom-right with text '© wipro confidential <slide-number>' in 8-9pt gray.
The cover slide is the exception — orange/white curved split, dual logos top-right, large title in dark navy/black, date in red below.

TYPOGRAPHY: Calibri for everything. 11-14pt body, 24-28pt titles. Section labels in navy bold. No display fonts, no script, no decorative weights.

COLOR: Maroon only in title bar. Navy (#0F2C59) for inline emphasis (numbers, owners, key terms). Charcoal gray for table dividers. Orange (#F37021) ONLY on cover. Avoid bright accents on body content.

LAYOUT: Document-style. Body slides should be:
- Two-column bulleted lists (Assumptions / Dependencies, Covered / Not covered)
- Wide tables with bold header rows and banded rows (alternating white / very-light gray)
- Multi-paragraph commentary with section sub-headers
- Orthogonal flowcharts (clean rectangles + arrows, no curves)
- T&Cs / legal text in small dense paragraphs

CONTENT: Information-density-first. The audience is reading this carefully — they expect detail, owner attribution, dates, dependencies. Don't simplify.

DO NOT: use gradient backgrounds, smart-art with playful curved layouts, oversized decorative letters, blob shapes, or any visual flair that distracts from the content. The brand is "trustworthy and thorough", not "bold and creative".`,
  layoutPatterns: [
    {
      type: "title_bar_with_content",
      frequency: 1.0,
      description: "Every body slide has the maroon title bar at top + footer. This is the master template.",
      content_density: "n/a",
    },
    {
      type: "data_table",
      frequency: 0.30,
      description: "Wide table with bold header row (gray fill), banded rows (alternating white / light-gray), 1pt gray borders. Used for commentary, line items, owner breakdowns.",
      content_density: "very high",
    },
    {
      type: "two_column_bulleted_lists",
      frequency: 0.25,
      description: "Two columns labeled (e.g. Assumptions / Dependencies) with numbered or bulleted lists. 8-13 items per column is normal.",
      content_density: "very high",
    },
    {
      type: "two_column_bullets_plus_table",
      frequency: 0.15,
      description: "Left: bulleted text in gray box (Covered / Not covered). Right: a table with header row.",
      content_density: "very high",
    },
    {
      type: "multi_paragraph_commentary",
      frequency: 0.10,
      description: "Multiple short sub-headed paragraphs. No bullets — prose.",
      content_density: "very high",
    },
    {
      type: "flowchart_orthogonal",
      frequency: 0.10,
      description: "Orthogonal flowchart with rectangles and right-angle connectors. Clean, no curves.",
      content_density: "high",
    },
    {
      type: "terms_and_conditions",
      frequency: 0.10,
      description: "Small-font numbered legal text. No visual elements at all besides title bar + footer.",
      content_density: "very high",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Wipro — Modern enterprise consulting. Bold purple/teal, photography, dot-grid.
// ─────────────────────────────────────────────────────────────────────
const WIPRO_PROFILE = {
  name: "Wipro Consulting",
  description:
    "Modern enterprise consulting style. Deep purple/teal brand colors, hero photography, dot-grid decorative pattern, bold confident typography. Built for capability briefs and strategy decks.",
  themeConfig: {
    colors: {
      primary: "#3D195B",        // Wipro Deep Purple
      secondary: "#1AAEC3",      // Wipro Teal
      accent1: "#F8B944",        // Wipro Gold/Yellow — for stat callouts
      accent2: "#FF6B35",        // Wipro Orange — for emphasis pop
      background: "#FFFFFF",
      surface: "#F7F7F8",
      text_primary: "#1A1A2E",
      text_muted: "#5A5A6E",
      text_inverse: "#FFFFFF",
    },
    heading_font: "Inter",
    body_font: "Inter",
    mood: "wipro-modern-consulting",
  },
  visualStyle: {
    design_language:
      "Modern enterprise consulting — confident and visually polished without becoming a marketing pitch. Photography of real workplace subjects with circular crops, dot-grid decorative patterns at corners (Wipro signature), bold sans-serif typography. The brand sits between IBM's restraint and a startup deck's flair — professional but warm.",
    spacing:
      "Balanced. ~35-40% negative space on body slides. Cover and section dividers may have generous bleeding background colors.",
    typography_hierarchy:
      "Display titles 64-96pt heavy weight (700-800). H1 40-48pt. Body 16-18pt. Inter throughout. Title alignment is upper-left or center-left depending on slide type.",
    title_anchors: ["upper-left", "center-left"],
    decoratives:
      "DOT-GRID PATTERN at corners (small dots in primary or secondary color, lower-right or upper-right) — this is Wipro's signature decorative. Curved background overlays on covers (large half-circles in brand color bleeding from one edge). Hero photography with CIRCULAR CROPS on cover slides. Section divider slides are full-bleed brand-color (purple or teal) with bold display title in white.",
    color_discipline:
      "Purple primary, teal secondary — these dominate. Gold/yellow for stat callouts and emphasis. Orange for occasional pop. Body slide backgrounds are white; section dividers are deep brand color.",
    photography:
      "Real workplace + technology photography. Often cropped CIRCULAR. Hands using a payment device, a person at a workstation, a server room. Should feel real, not stock-staged. Black-and-white tinting OK but not required.",
    icons:
      "Outlined modern icons in primary/secondary color. Sometimes solid black icons inside colored star-burst shapes (see ROI Snapshot pattern: black star polygons with white outline icons inside).",
    info_density: "medium-to-high",
    composition:
      "Cover and section dividers are full-color brand statements with photography or large display titles. Body slides are content-rich with stat callouts, capability ladders (stepped bar charts with annotations), case-study split layouts (3 panels with metrics), and engagement-timeline diagrams (swim-lane with chevron stages on top).",
  },
  styleGuide: `Wipro modern consulting style — confident, polished, mid-density between IBM's clean restraint and a startup deck's flair.

COVER SLIDES: Full-bleed brand color (deep purple #3D195B preferred), bold display title in white 80-96pt LEFT-ALIGNED, subtitle below, date below subtitle. Dual logos (Wipro + Client) top-left or top-center. A dot-grid pattern (small circles) decorates the lower-right corner. Optional: a large hero photograph cropped CIRCULAR on the right side, with text on the left.

SECTION DIVIDERS: Full-bleed teal (#1AAEC3) or purple. Bold white display title 96pt+. Numbered subtitle below ("1. Proof of Value"). Dot-grid pattern in opposite corner. Wipro logo top-left.

BODY SLIDES: White background, dot-grid in lower-right corner at 30-40% opacity (Wipro signature). Title at upper-left, h1 tier, dark navy/purple. Content varies — often stat callouts in colored panels, capability ladders, case-study 3-panel splits.

TYPOGRAPHY: Inter. Display titles heavy (800), H1 bold (700), body regular. Bold inline orange (#FF6B35) for semantic emphasis on key terms — this is a Wipro signature for narrative slides.

COLOR: Purple primary, teal secondary, gold/yellow for big stats, orange for pop. White text on dark, dark text on light. Use color confidently but not chaotically — at most 3 colors on a single body slide.

DECORATIVES:
- Dot-grid pattern (~12x12 dots, ~15% opacity, brand color) in a corner — appears on most slides
- Curved/half-circle overlays on covers (large bleed shapes)
- Circular photo crops on hero slides
- Black star-polygon icon containers (5-pointed star shape) for ROI/benefit slides — see Mastercard ROI Snapshot pattern

PHOTOGRAPHY: Real, contextual, often circular crops. Workplace, technology, hands-using-product. Avoid stock-photo cliches.

PATTERNS:
- Capability Ladder: stepped bar chart, 5 levels of value progression, each step with KPI annotation in italic. Below: 3 black "differentiator" cards.
- ROI Snapshot: pentagon arrangement of icons left, numbered list (01-05) with title + description right.
- PoV Timeline: swim-lane with chevron stages on top (Pre-PoV / Get Started / Discovery / Business Impact), 3 lanes (Leadership / Management / Tech) with diamond markers.
- Case Study Split: title bar on top, 3 vertical panels (Challenge / Engagement / Outcome) with metrics + bullets per panel.
- Storyline narrative: paragraph text with key terms in bold-orange inline.

DO NOT: use IBM-style ultra-minimal layouts (we want more visual richness), heavy Calibri-style document tables (Wipro is more visual than ICICI), or generic Office/PowerPoint defaults.`,
  layoutPatterns: [
    {
      type: "branded_cover",
      frequency: 1.0,
      description: "Cover slide — full-bleed deep purple with bold white display title, optional circular hero photo, dual logos top, dot-grid pattern lower-right, date in white below subtitle.",
      content_density: "low",
    },
    {
      type: "section_divider",
      frequency: 0.10,
      description: "Full-color (teal or purple) full-bleed slide with large white display title and numbered subtitle. Dot-grid in a corner.",
      content_density: "very low",
    },
    {
      type: "stat_callout_with_panel",
      frequency: 0.15,
      description: "Title on left in bold, multiple big-number stats (1.5x-2x, 50%, 70%) on the right with descriptors. Brand-color panel backdrop.",
      content_density: "medium",
    },
    {
      type: "capability_ladder",
      frequency: 0.10,
      description: "Stepped bar chart with 5 levels of progression. Each step has an italic KPI annotation pointing to it. Below: 3 black 'differentiator' cards.",
      content_density: "high",
    },
    {
      type: "roi_pentagon_with_numbered_list",
      frequency: 0.10,
      description: "Pentagon arrangement of black star-polygon icon containers (5 segments) on left. Numbered list 01-05 with title + description on right.",
      content_density: "high",
    },
    {
      type: "pov_swim_lane_timeline",
      frequency: 0.05,
      description: "Top: chevron stages (Pre-PoV, Get Started, Discovery, Business Impact). 3 horizontal lanes (Leadership, Management, Tech) with diamond event markers. Bottom: numbered checkpoints with bullets per stage.",
      content_density: "very high",
    },
    {
      type: "case_study_three_panel",
      frequency: 0.10,
      description: "Title bar on top with project name. 3 vertical panels (Challenge / Engagement & Outcome / Outcome). Each panel has bulleted text + a stat chart or callouts. Metrics row at top right (e.g. 47%, 12 weeks, 28x).",
      content_density: "very high",
    },
    {
      type: "storyline_narrative_paragraph",
      frequency: 0.10,
      description: "Text-heavy paragraphs, no specific layout, key terms in bold-orange inline. Used for executive summaries and 'why this matters' slides.",
      content_density: "very high",
    },
    {
      type: "functional_architecture",
      frequency: 0.10,
      description: "Logos/icons stacked on left side. Center: colored box (orange/purple) labeling the central system. Right: stacked cards categorizing features. Multi-zone with color coding.",
      content_density: "high",
    },
  ],
};

// BITS Pilani — Education sector. Based on the Birla Institute Keynote
// template (clock-tower photo cover, innovate/achieve/lead 3-color accent
// strip, deep cobalt + warm gold/red/blue accents, serif body, bold
// sans-serif titles).
const BITS_PILANI_PROFILE = {
  name: "BITS Pilani Institutional",
  description: "Birla Institute of Technology and Science academic deck — cobalt cover, 3-color innovate/achieve/lead accent rule, serif body, photo-led storytelling.",
  category: "education",
  themeConfig: {
    colors: {
      primary: "#1A3A6B",            // BITS deep cobalt
      secondary: "#0F2A4D",           // darker navy for headers
      accent1: "#F4B400",             // "innovate" gold
      accent2: "#5BC0EB",             // "achieve" sky blue
      accent3: "#E74C3C",             // "lead" red
      accent4: "#FFFFFF",
      background: "#FFFFFF",
      surface: "#F5F8FB",            // very pale blue for content cards
      text_primary: "#000000",
      text_muted: "#4A5568",
    },
    heading_font: "Helvetica Neue",
    body_font: "Times New Roman",
    mono_font: "Menlo",
  },
  visualStyle: {
    design_language:
      "Academic-institutional. Photo-anchored covers (the iconic BITS clock tower against blue sky). Body slides are clean white with the 3-color accent rule top + bottom. Serif body text gives the deck a traditional, considered tone — never modern startup feel.",
    typography_treatment:
      "Slide titles in bold Helvetica Neue (or system sans), 32–40pt, left-aligned, black. Body text in Times New Roman (or Cambria), 18–22pt, regular weight. Italic for subtitles ('Pilani Campus'). Bold for emphasis inline. Never reverse-out white text on white slides.",
    decoratives:
      "Cover slides use a full-bleed photo (clock tower, campus, students) with the BITS Pilani wordmark + circular crest top-right. Body slides use a horizontal accent rule (gold → sky blue → red, equal thirds) BOTH at top under the title AND at the bottom above the footer. A faint repeating watermark — 'Learning, Integrated Programmes, Work' — sits behind body text on instructional slides only.",
    color_discipline:
      "Cobalt blue dominates the cover. Body slides are mostly white with the 3-color stripe as the ONLY decorative color. NEVER mix colors into the body text — keep everything black serif. The gold/blue/red rule is the brand signature; do not omit it.",
    info_density: "medium",
  },
  styleGuide: `BITS Pilani academic style. The signature is a balance of institutional gravitas and warmth — serif body text says "this is education, take it seriously," while the gold/blue/red accent rule (innovate / achieve / lead) keeps it from feeling cold.

TYPOGRAPHY: Bold Helvetica Neue (or system sans) for slide titles (32–40pt, left-aligned, BLACK on white). Times New Roman / Cambria for ALL body text (18–22pt regular). Italics for subtitles like "Pilani Campus" or unit names. Never set body text in sans-serif — the serif is non-negotiable for the academic feel.

LAYOUT: Cover slide is photo-led — a tower / campus image fills the slide with a horizontal blue band (left ~40%, full height) carrying the BITS Pilani crest + wordmark + "Faculty Name / Faculty Department" footer. Body slides have the title top-left in bold black sans-serif, a horizontal 3-color accent rule (gold-blue-red equal thirds) BELOW the title, then content. Same rule appears at the bottom above the footer ("BITS Pilani, Pilani Campus").

COLOR: Cobalt blue (#1A3A6B) is the primary — used for cover backgrounds and accent fills. The 3-color accent rule (gold #F4B400 / sky #5BC0EB / red #E74C3C) is the ONLY decorative color on body slides. Body content is BLACK serif on WHITE — no colored body text. Avoid gradients, glow effects, or competing accent palettes.

DECORATION: The accent rule top + bottom is the brand signature. Add the BITS wordmark + crest bottom-right on cover slides. On instructional / content-heavy slides, a faint diagonal watermark ("Learning · Integrated Programmes · Work") sits behind the body text in light gray.

CONTENT: Information-dense academic. Multi-line lists, topical agendas, architecture diagrams, references. Avoid bullet-list-only slides; prefer diagram + caption + cited source. Photos of campus/people are welcome on cover and section dividers. Code blocks and equations are OK in Menlo / Cambria Math.`,
  layoutPatterns: [
    {
      type: "photo_cover_with_blue_band",
      frequency: 0.15,
      description: "Full-bleed campus / tower photo with a solid cobalt band on the left ~40% width, full height. Band carries the BITS Pilani crest + wordmark + presentation title + faculty footer.",
      content_density: "low",
    },
    {
      type: "title_with_tricolor_rule",
      frequency: 0.50,
      description: "White background. Bold black sans-serif title top-left. Below the title: horizontal 3-color rule (gold / sky blue / red, equal thirds). Body content (serif) below. Bottom of slide repeats the 3-color rule above the BITS footer.",
      content_density: "medium",
    },
    {
      type: "agenda_or_topic_list",
      frequency: 0.15,
      description: "Title 'Topics' or 'Agenda' top-left. Right-aligned numbered list in Times serif, 18–22pt, with generous line-height. Faint diagonal 'Learning, Integrated Programmes, Work' watermark behind the list.",
      content_density: "medium",
    },
    {
      type: "section_divider",
      frequency: 0.10,
      description: "Cobalt background with the section name in large white Helvetica bold (48pt+). Optional small crest top-right.",
      content_density: "low",
    },
    {
      type: "diagram_or_architecture",
      frequency: 0.10,
      description: "White background. Title + tricolor rule on top. Center area holds a labeled diagram (boxes + arrows in cobalt blue) with serif callout text. Footer tricolor rule + BITS wordmark.",
      content_density: "high",
    },
  ],
};

// HDFC Bank — BFSI/banking corporate. Deep blue + red brand accent, dense
// numerical content, compliance footers.
const HDFC_BANK_PROFILE = {
  name: "HDFC Bank Corporate",
  description: "Indian banking-corporate template — deep navy + signature red, dense tables and KPI grids, regulatory footers, conservative typography.",
  category: "bfsi",
  themeConfig: {
    colors: {
      primary: "#004C8F",            // HDFC deep navy
      secondary: "#ED232A",          // HDFC red
      accent1: "#F7C600",            // gold accent (rare)
      accent2: "#003366",            // navy headers
      accent3: "#666666",            // body grey
      accent4: "#FFFFFF",
      background: "#FFFFFF",
      surface: "#F4F6F9",
      text_primary: "#111111",
      text_muted: "#5A6B7C",
    },
    heading_font: "Arial",
    body_font: "Arial",
    mono_font: "Consolas",
  },
  visualStyle: {
    design_language:
      "Conservative banking. White slides with a deep-navy top band carrying the slide title in white. Red is used SPARINGLY — only for KPI highlights, callouts, or the HDFC logo. Tables, tables, tables.",
    typography_treatment:
      "Arial throughout. Titles 22–26pt navy or white-on-navy. Body 12–14pt grey. Tables use 10–11pt with bold navy header rows.",
    decoratives:
      "Top navy band (~50px) holds the slide title in white. Bottom slim navy band carries the date + 'Internal Use Only' or 'Confidential' footer + slide number. The HDFC logo sits bottom-right on every slide.",
    color_discipline:
      "Navy is the brand. Red is for emphasis ONLY (positive growth KPIs, callouts). Grey body text. White slide background.",
    info_density: "very high",
  },
  styleGuide: `HDFC Bank corporate style. The signature is information density + restraint — a typical body slide shows a dense table or a chart with annotations, NEVER big visuals or splashy graphics. The visual identity is the navy band header + the disciplined typography, not decoration.

TYPOGRAPHY: Arial throughout (system fallback Helvetica). Slide titles 22–26pt navy (#004C8F) or white-on-navy if on the top band. Section headings 16–18pt navy bold. Body 12–14pt #111 or #5A6B7C for secondary. Table headers 11pt white-on-navy bold; table cells 10–11pt #111 with #F4F6F9 zebra striping.

LAYOUT: Top navy band (slim ~50px) carrying the slide title in white left-aligned. Body fills the rest of the slide with tables, charts, or numbered lists. Bottom navy band (thinner, ~20px) with the date, footer text ("Internal Use Only" / "Confidential"), and slide number. HDFC logo bottom-right above the bottom band, always visible.

COLOR: Navy (#004C8F) is the brand — top/bottom bands, table headers, section bars. Red (#ED232A) is ONLY for: HDFC logo, positive KPI deltas ("+12% YoY"), or compliance call-outs ("Mandatory"). Body grey (#5A6B7C). Avoid gradients, drop shadows, transparency effects.

CONTENT: Banking + financial — tables of fees, AUM, branches, customer counts; charts with quarterly trends; regulatory disclosures. Bullet lists should always have monetary or percentage values. Photos are RARE — only for executive headshots or branch photos. No stock imagery.`,
  layoutPatterns: [
    {
      type: "navy_band_title_with_table",
      frequency: 0.45,
      description: "Top navy band with white title. Body is a 4-6 column data table with navy header row, zebra striping, and a callout column (red text or icon) for the headline metric.",
      content_density: "very high",
    },
    {
      type: "navy_band_title_with_chart",
      frequency: 0.25,
      description: "Top navy band + slide title. Center: bar/line chart in navy + grey, with red used ONLY for the YoY growth annotation. Right rail: 3-4 KPI cards with navy header strips.",
      content_density: "high",
    },
    {
      type: "compliance_or_regulatory",
      frequency: 0.15,
      description: "Title + dense paragraph text in 12pt grey with monetary/percentage values bolded. Side rail with citation numbers / source labels.",
      content_density: "very high",
    },
    {
      type: "section_divider_navy",
      frequency: 0.05,
      description: "Full-bleed navy slide with section name in large white Arial bold (40pt+). HDFC logo top-right.",
      content_density: "low",
    },
    {
      type: "executive_summary_kpis",
      frequency: 0.10,
      description: "Cover/section: 4-6 stat cards horizontally with navy top accent strip and big-number KPI in 36pt navy bold below.",
      content_density: "medium",
    },
  ],
};

// Tata Consultancy Services — IT/Consulting global. Indigo + cyan accent,
// stack-oriented diagrams, lots of icons, sustainability messaging.
const TCS_PROFILE = {
  name: "TCS Consulting",
  description: "Indian IT services template — indigo + cyan, layered architecture diagrams, customer-outcome KPIs, clean modernist layouts.",
  category: "consulting",
  themeConfig: {
    colors: {
      primary: "#3B3F8F",            // TCS indigo
      secondary: "#1FA2FF",          // bright cyan
      accent1: "#00B894",            // sustainable green
      accent2: "#FF7043",            // orange call-outs
      accent3: "#6C5CE7",
      accent4: "#FFFFFF",
      background: "#FFFFFF",
      surface: "#F7F9FC",
      text_primary: "#1A1A2E",
      text_muted: "#5A5A78",
    },
    heading_font: "Helvetica Neue",
    body_font: "Helvetica Neue",
    mono_font: "Source Code Pro",
  },
  visualStyle: {
    design_language:
      "Clean modernist IT-services. Indigo branded with cyan as the dominant accent. Layered architecture diagrams (boxes + arrows + icons) are the signature content type — every deck has at least one.",
    typography_treatment:
      "Helvetica Neue throughout. Titles 28–34pt indigo bold. Body 14–16pt #1A1A2E regular. Icon labels 11–12pt grey.",
    decoratives:
      "Top thin indigo bar (3-4px) under the slide title. TCS logo bottom-right. Section divider slides use a diagonal indigo wedge.",
    color_discipline:
      "Indigo for primary structure, cyan for arrows/connectors/highlights. Green for sustainability/positive outcomes. Orange for warnings or new launches only. Never mix more than 3 accent colors on one slide.",
    info_density: "high",
  },
  styleGuide: `TCS consulting style. Indigo + cyan modernist with disciplined whitespace. The signature visual is a multi-layer architecture diagram (data layer → integration → AI/ML → consumption) with icons in each layer.

TYPOGRAPHY: Helvetica Neue throughout. Slide titles 28–34pt indigo bold (#3B3F8F), left-aligned. Body 14–16pt #1A1A2E regular. Layer labels in architecture diagrams 13pt indigo bold. Bullet lists prefer 1-line items with icons.

LAYOUT: Title top-left with a thin 3px indigo underline. Body fills the rest. Architecture-style diagrams span the full width with 4-6 horizontal layers (data → processing → AI/ML → application → consumption), each layer in light surface (#F7F9FC) with indigo header strip. Bottom-right: TCS logo. No top/bottom bands — clean breathing room.

COLOR: Indigo (#3B3F8F) is the primary — title color, layer headers, structural lines. Cyan (#1FA2FF) for connectors / arrows / inline highlights. Green (#00B894) for sustainability metrics / positive KPI changes. Orange (#FF7043) ONLY for "new" or "launch" callouts. Light surface (#F7F9FC) for diagram backdrops.

DECORATION: Layered architecture diagrams are the brand signature — every deck has at least one. Use rounded rectangles for components, simple line arrows for data flow (cyan, 2pt), and icons for each layer (database, API, AI, mobile, dashboard). Avoid gradients on the components; flat fills only.

CONTENT: Customer outcomes + sustainability + AI/ML. KPIs framed as "X% efficiency gain" or "Y trees saved." Avoid jargon-heavy slides; prefer outcome-first headlines.`,
  layoutPatterns: [
    {
      type: "layered_architecture",
      frequency: 0.30,
      description: "Slide-wide multi-layer diagram (4-6 horizontal layers) with light surface backdrop, indigo header strips per layer, cyan connectors between. Icons populate each layer.",
      content_density: "high",
    },
    {
      type: "outcome_kpis_grid",
      frequency: 0.20,
      description: "4-6 KPI cards in a grid (2x2 or 2x3) with indigo top strip, big-number KPI in 32pt indigo bold, and a green/cyan icon + delta caption.",
      content_density: "medium",
    },
    {
      type: "industry_landscape_logos",
      frequency: 0.10,
      description: "Title + a grid of customer/partner logos arranged by industry vertical, with indigo dividers between groups.",
      content_density: "high",
    },
    {
      type: "process_flow_horizontal",
      frequency: 0.20,
      description: "5-7 stage horizontal flow with rounded-rect stages connected by cyan arrows, each stage with icon + 2-line description.",
      content_density: "medium",
    },
    {
      type: "sustainability_callout",
      frequency: 0.10,
      description: "Green-themed slide highlighting environmental KPIs — trees saved, carbon offset, water reused. Big number + green badge + supporting text.",
      content_density: "low",
    },
    {
      type: "section_divider_diagonal",
      frequency: 0.10,
      description: "Section title slide with a diagonal indigo wedge from bottom-left to top-right. White text on indigo half.",
      content_density: "low",
    },
  ],
};

const PROFILES = [
  IBM_PROFILE,
  ICICI_PROFILE,
  WIPRO_PROFILE,
  BITS_PILANI_PROFILE,
  HDFC_BANK_PROFILE,
  TCS_PROFILE,
];

// Attach a `category` to existing profiles so the catalog filter chips work
// for the original three too. Order must match PROFILES above.
const PROFILE_META: Record<string, string> = {
  "IBM Enterprise": "it",
  "ICICI Bank Corporate": "bfsi",
  "Wipro Consulting": "consulting",
};

// Idempotent: upserts by (name, isGlobal:true). Safe to re-run on every deploy.
// Exposed so the main seed can call this without spawning a separate process.
// Profiles that should ALWAYS show in the per-project / dashboard style
// selector for every user (isGlobal=true). Everything else is catalog-only
// (isGlobal=false, isPublic=true) — users discover it on /catalog and
// explicitly clone into their own profiles.
const ALWAYS_DEFAULT = new Set<string>(["IBM Enterprise", "Wipro Consulting"]);

export async function seedGlobalStyleProfiles(prisma: PrismaClient) {
  for (const p of PROFILES) {
    const category = (p as { category?: string }).category || PROFILE_META[p.name] || "other";
    const isDefault = ALWAYS_DEFAULT.has(p.name);
    const sharedData = {
      description: p.description,
      themeConfig: p.themeConfig,
      visualStyle: p.visualStyle,
      styleGuide: p.styleGuide,
      layoutPatterns: p.layoutPatterns,
      status: "ready" as const,
      category,
      // Both true → shows in selector + catalog.
      // Only isPublic → catalog-only (catalog clones bring it into a user's selector).
      isGlobal: isDefault,
      isPublic: true,
    };

    // Look up by name only — we may be flipping isGlobal from true → false
    // on an existing row (BITS/HDFC/TCS/ICICI demotion).
    const existing = await prisma.styleProfile.findFirst({
      where: { name: p.name, userId: null },
    });

    if (existing) {
      await prisma.styleProfile.update({
        where: { id: existing.id },
        data: sharedData,
      });
      console.log(
        `Updated  ${p.name}  [${category}]  ` +
        `${isDefault ? "default+catalog" : "catalog-only"}  (${existing.id})`,
      );
    } else {
      const created = await prisma.styleProfile.create({
        data: {
          name: p.name,
          userId: null,
          ...sharedData,
        },
      });
      console.log(
        `Created  ${p.name}  [${category}]  ` +
        `${isDefault ? "default+catalog" : "catalog-only"}  (${created.id})`,
      );
    }
  }
  console.log(`\nDone. ${PROFILES.length} style profiles seeded.`);
}

// Standalone runner — invoked by `pnpm db:seed:styles`.
// Only runs when this file is the process entry point.
const isMain = process.argv[1]?.endsWith("seed-style-profiles.ts") ||
               process.argv[1]?.endsWith("seed-style-profiles.js");
if (isMain) {
  seedGlobalStyleProfiles(standalonePrisma)
    .then(async () => {
      await standalonePrisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await standalonePrisma.$disconnect();
      process.exit(1);
    });
}
