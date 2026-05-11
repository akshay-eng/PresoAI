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

const prisma = new PrismaClient();

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

const PROFILES = [IBM_PROFILE, ICICI_PROFILE, WIPRO_PROFILE];

async function main() {
  for (const p of PROFILES) {
    // Find existing global profile by name (since we don't have a unique on name+isGlobal)
    const existing = await prisma.styleProfile.findFirst({
      where: { name: p.name, isGlobal: true },
    });

    if (existing) {
      await prisma.styleProfile.update({
        where: { id: existing.id },
        data: {
          description: p.description,
          themeConfig: p.themeConfig,
          visualStyle: p.visualStyle,
          styleGuide: p.styleGuide,
          layoutPatterns: p.layoutPatterns,
          status: "ready",
        },
      });
      console.log(`Updated  ${p.name}  (${existing.id})`);
    } else {
      const created = await prisma.styleProfile.create({
        data: {
          name: p.name,
          description: p.description,
          isGlobal: true,
          userId: null,
          status: "ready",
          themeConfig: p.themeConfig,
          visualStyle: p.visualStyle,
          styleGuide: p.styleGuide,
          layoutPatterns: p.layoutPatterns,
        },
      });
      console.log(`Created  ${p.name}  (${created.id})`);
    }
  }
  console.log(`\nDone. ${PROFILES.length} default style profiles seeded.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
