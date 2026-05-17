import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Code2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresoLogo } from "@/components/preso-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { DocsClient } from "./docs-client";

export const metadata = {
  title: "Docs · Preso",
  description:
    "Learn what Preso does, how to use the app, and how to integrate the REST API for programmatic deck generation.",
};

const SECTIONS: Array<{ id: string; label: string; group?: string }> = [
  { group: "Overview", id: "what-is-preso", label: "What is Preso" },
  { id: "first-deck", label: "Generate your first deck" },
  { group: "Using the app", id: "engines", label: "Generation engines" },
  { id: "audience", label: "Audience type" },
  { id: "creative-mode", label: "Creative Mode" },
  { id: "diagrams", label: "Diagrams Engine" },
  { id: "image-gen", label: "Image generation" },
  { id: "brand-styles", label: "Brand styles" },
  { id: "references", label: "Reference decks & images" },
  { id: "editing", label: "Editing slides in chat" },
  { id: "live-editor", label: "Live PowerPoint editor" },
  { id: "find", label: "Slide Finder" },
  { group: "REST API", id: "api-overview", label: "Overview" },
  { id: "auth", label: "Authentication" },
  { id: "concepts", label: "Async jobs & idempotency" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "errors", label: "Error codes" },
  { group: "Endpoints", id: "ep-create-deck", label: "POST /v1/decks" },
  { id: "ep-get-job", label: "GET /v1/jobs/{id}" },
  { id: "ep-stream-job", label: "GET /v1/jobs/{id}/stream" },
  { id: "ep-edit-deck", label: "POST /v1/decks/{id}/edit" },
  { id: "ep-get-deck", label: "GET /v1/decks/{id}" },
  { id: "ep-download-deck", label: "GET /v1/decks/{id}/download" },
  { id: "ep-files", label: "POST /v1/files" },
  { id: "ep-style-profiles", label: "GET /v1/style-profiles" },
  { id: "ep-llm-configs", label: "GET /v1/llm-configs" },
  { group: "MCP server", id: "mcp-overview", label: "Overview" },
  { id: "mcp-auth", label: "Authentication" },
  { id: "mcp-tools", label: "Tools" },
  { id: "mcp-claude-desktop", label: "Claude Desktop" },
  { id: "mcp-cursor", label: "Cursor" },
  { id: "mcp-n8n", label: "n8n" },
  { id: "mcp-custom", label: "Custom client" },
  { group: "More", id: "openapi", label: "OpenAPI spec" },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top nav — matches the landing page */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <PresoLogo size="md" />
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground border-l border-border pl-3">
              <BookOpen className="h-3 w-3" /> Docs
            </span>
          </Link>
          <nav className="flex items-center gap-1.5">
            <Link href="/docs/api">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                API Explorer
              </Button>
            </Link>
            <ThemeToggle />
            <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/auth/register">
              <Button size="sm">
                Get Started <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <DocsClient sections={SECTIONS}>
        {/* ───────────────────────── Overview ───────────────────────── */}
        <section id="what-is-preso" className="docs-section">
          <span className="docs-eyebrow">Overview</span>
          <h1 className="text-3xl font-bold tracking-tight">What is Preso?</h1>
          <p className="docs-lead">
            Preso turns a one-line prompt into a finished, marketing-quality
            PowerPoint deck. You describe the topic and audience; Preso does
            the research, picks a layout for every slide, applies a brand
            palette, and gives you a real <code>.pptx</code> file you can open
            in PowerPoint, edit in the browser, or download.
          </p>
          <p>
            It&apos;s built for two kinds of users: people who want a deck
            without learning a design tool, and developers who want to plug
            deck generation into their own products via an API and an MCP
            server.
          </p>

          <div className="grid sm:grid-cols-2 gap-3 mt-6">
            <FeatureBlurb
              title="Plain-English prompts"
              body="Type what the deck is about — Preso writes the slides, picks the visuals, and stays on-brand."
            />
            <FeatureBlurb
              title="Real PowerPoint files"
              body="Output is an actual editable .pptx — not an image, not a Google Slides clone. Open it in any office tool."
            />
            <FeatureBlurb
              title="Brand-aware"
              body="Upload a sample deck once. Preso learns your colours, fonts, and layout grammar and reuses them everywhere."
            />
            <FeatureBlurb
              title="API + MCP"
              body="Every UI feature is also a REST endpoint. Connect it to Claude Desktop, n8n, your backend, or a custom agent."
            />
          </div>
        </section>

        <section id="first-deck" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Generate your first deck</h2>
          <p>
            Sign in, type your idea into the home-page input, and hit send.
            That&apos;s the whole flow. Behind that one box, Preso is doing all
            of the following — and you can tweak each part from the{" "}
            <span className="docs-kbd">+</span> menu next to the input.
          </p>
          <ol className="list-decimal pl-6 space-y-2 mt-4">
            <li>It checks the input is actually a deck request (saying &quot;hi&quot; just gets a friendly redirect).</li>
            <li>It picks a name for your project from the prompt.</li>
            <li>It does live web research for facts, stats, and benchmarks.</li>
            <li>It picks a colour palette — either from the brand style you chose, or by analyzing the topic.</li>
            <li>It writes the slides, fills shapes/charts/diagrams, and renders the final <code>.pptx</code>.</li>
            <li>You can download, preview, edit in-browser, or ask for changes in chat.</li>
          </ol>
        </section>

        {/* ───────────────────────── Using the app ───────────────────────── */}
        <section id="engines" className="docs-section">
          <span className="docs-eyebrow">Using the app</span>
          <h2 className="text-2xl font-semibold tracking-tight">Generation engines</h2>
          <p>
            Preso has multiple engines, each tuned for a different output
            quality and cost trade-off. Switch between them in the{" "}
            <span className="docs-kbd">+</span> menu &rarr; <em>Engine</em>.
          </p>
          <div className="grid gap-3 mt-4">
            <EngineCard
              name="Preso Elite"
              tag="Recommended"
              body="The default. Generates pptxgenjs slide source with a strict design system: locked palette, native shapes (hexagons, chevrons, trapezoids, callouts), real charts. Best mix of speed and quality. Supports surgical edits — ask for a colour change and only that slide regenerates."
            />
            <EngineCard
              name="Preso Pro"
              body="Python-based composer that emits real native PowerPoint SmartArt — cycle3, hexagon timelines, hierarchy diagrams, lProcess trapezoid stacks. PowerPoint's own SmartArt Design ribbon stays active for those slides. Best when you need editable native diagrams."
            />
            <EngineCard
              name="Preso Plus"
              tag="Coming soon"
              body="Agentic engine driving Gemini 2.5 Pro for the heaviest research/synthesis work. Slowest but most thorough. Useful for board decks where you want hours of research compressed into 30 minutes."
            />
          </div>
        </section>

        <section id="audience" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Audience type</h2>
          <p>
            Tells the agent how to balance density and tone. Same content can
            land very differently depending on who&apos;s in the room.
          </p>
          <ul className="docs-list mt-3">
            <li><strong>Executive</strong> — bottom-line first, big stat callouts, dark hero slides, premium aesthetic.</li>
            <li><strong>Technical</strong> — architecture diagrams, comparison tables, real metrics, denser information.</li>
            <li><strong>General</strong> — balanced, approachable, journey maps and analogies.</li>
            <li><strong>Marketing</strong> — vivid colours, expressive typography, hero-led layouts.</li>
          </ul>
        </section>

        <section id="creative-mode" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Creative Mode</h2>
          <p>
            Toggle the <span className="docs-kbd">Creative</span> chip below
            the prompt input. Pushes the agent past the standard playbook —
            for at least one slide you&apos;ll see something unconventional:
            a stacked-trapezoid pyramid, a hub-and-spoke radial diagram, a
            quadrant matrix, or a comparison diptych. Same data, more memorable
            framing. Costs slightly more tokens because the model temperature
            and shape budget are higher.
          </p>
          <p className="text-sm text-muted-foreground italic mt-2">
            When to enable: pitches, board decks, anything that has to be
            visually memorable. When to disable: training material, dense
            internal review decks where speed matters more than punch.
          </p>
        </section>

        <section id="diagrams" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Diagrams Engine</h2>
          <p>
            Toggle the <span className="docs-kbd">Diagrams</span> chip to let
            the agent render complex diagrams (sequence flows, system
            architecture, ER models, gantt charts, user journeys) as
            high-quality images via{" "}
            <a href="https://kroki.io" target="_blank" rel="noreferrer noopener" className="docs-link">
              Kroki <ExternalLink className="h-3 w-3 inline" />
            </a>
            . With it off, the agent draws those diagrams using native
            PowerPoint shapes (less polished, fully editable). With it on,
            you get publication-quality renderings — but those slides are
            images, not editable shapes.
          </p>
          <p className="text-sm text-muted-foreground italic mt-2">
            When to enable: technical decks where diagram fidelity matters
            and the audience won&apos;t edit the slides. When to disable:
            anything you might want to tweak in PowerPoint after generation.
          </p>
          <h3 className="text-base font-semibold mt-5">Native SmartArt fallbacks</h3>
          <p>
            For common diagram shapes — hub-and-spoke (mindmap),
            chevron process flows, 2×2 matrices, hierarchies — the agent
            now reaches for native pptxgenjs shapes <em>before</em> Kroki.
            These render reliably, stay fully editable in PowerPoint, and
            inherit the deck&apos;s locked palette. Kroki is reserved for
            real charts (<code>vegalite</code>), sankey-beta flow volumes,
            gantt timelines, and ER models — places where native shapes
            would be a lot of work for the same result.
          </p>
        </section>

        <section id="image-gen" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Image generation</h2>
          <p>
            Toggle the <span className="docs-kbd">Images</span> chip
            (next to <span className="docs-kbd">Diagrams</span>) to let the
            agent generate photo-realistic backgrounds for the cover and
            section divider slides via Gemini Nano Banana. Defaults to{" "}
            <strong>OFF</strong> — image gen is an explicit opt-in because
            it costs an API call per slide and isn&apos;t always on-brand.
          </p>
          <h3 className="text-base font-semibold mt-5">How it works</h3>
          <ol className="list-decimal pl-6 space-y-1 mt-2">
            <li>
              When enabled, the slide-writer is told it can emit a single
              <code> // IMAGE_GEN: prompt=&quot;...&quot; tint=&quot;&lt;hex&gt;&quot; fade=&quot;bottom&quot; </code>
              comment at the top of cover / section-divider slides.
            </li>
            <li>
              The post-processor expands that marker into{" "}
              <code>slide.addImage(...)</code> for the generated photo, a
              brand-color tint overlay, and an automatic vertical fade
              behind the title so the text reads cleanly. All text and
              shapes you draw on top stay editable in PowerPoint.
            </li>
            <li>
              When disabled, the agent is explicitly told <em>not</em> to
              emit IMAGE_GEN markers; any stray markers are stripped
              before the deck ships. No Gemini calls, no charges.
            </li>
          </ol>
          <h3 className="text-base font-semibold mt-5">Brand logos</h3>
          <p>
            Brand names mentioned in the prompt (ServiceNow, Slack,
            Kubernetes, etc.) trigger a logo.dev lookup. Logos are
            scoped to integration / tech-stack / architecture slides
            only — never used as a watermark, never repeated across
            slides, and the deck&apos;s own product name is filtered out
            so a placeholder logo doesn&apos;t show up on the cover.
          </p>
          <p className="text-sm text-muted-foreground italic mt-2">
            When to enable: pitch decks, marketing, executive summaries
            where a hero photo carries weight. When to disable: drafts,
            iteration, anything where you want a shape-only result.
          </p>
        </section>

        <section id="brand-styles" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Brand styles</h2>
          <p>
            A &quot;style profile&quot; locks Preso&apos;s output to a brand
            identity — colours, fonts, layout patterns, voice. You can use
            three platform-built styles (IBM Enterprise, ICICI Bank Corporate,
            Wipro Consulting) or upload a few of your own decks and let Preso
            analyze them.
          </p>
          <h3 className="text-base font-semibold mt-5">Using a built-in style</h3>
          <p>
            Pick one from the <em>Brand Styles</em> shelf on the dashboard or
            from the prompt-bar menu. Every slide of your generated deck will
            use that brand&apos;s palette, fonts, and layout vocabulary.
          </p>
          <h3 className="text-base font-semibold mt-5">Building your own</h3>
          <ol className="list-decimal pl-6 space-y-1 mt-2">
            <li>Click <strong>+ New Style</strong> on the dashboard.</li>
            <li>Drop in 1–4 sample <code>.pptx</code> files that represent your brand.</li>
            <li>
              The Style Analyzer extracts theme XML (colours, fonts) without
              spending an LLM token, then samples 3–4 slides per file and asks a
              vision model to describe the visual grammar — typography
              treatment, spacing, decorative elements, info density.
            </li>
            <li>The analysis is saved as a profile you can attach to any project.</li>
          </ol>
        </section>

        <section id="references" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Reference decks &amp; images</h2>
          <p>
            Reference decks teach the agent the shape of the content you want.
            Drop in an existing deck, a PDF, or a research doc, and the agent
            will pull facts, structure, and (for PPTX) visual cues from it.
          </p>
          <p>
            Images go to the same place — paste a screenshot directly into the
            prompt box and the agent treats it as a vision input. Common use:
            &quot;clone this slide&quot; or &quot;match the layout in this
            example.&quot;
          </p>
        </section>

        <section id="editing" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Editing slides in chat</h2>
          <p>
            Once a deck exists, the project page acts like a chat with the
            agent. Type the change you want — &quot;make slide 3 a bar chart
            instead,&quot; &quot;change the cover title,&quot; &quot;add a
            thank-you slide&quot; — and Preso patches just the affected slides.
            It uses an intelligent edit pattern: locate, change,
            preserve everything else.
          </p>
          <p className="text-sm text-muted-foreground italic mt-2">
            Hard signals like &quot;new deck for X,&quot; &quot;different
            topic,&quot; or &quot;start over&quot; route to a full regenerate.
            Greetings and unrelated questions get a polite redirect with no
            tokens spent.
          </p>
        </section>

        <section id="live-editor" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Live PowerPoint editor</h2>
          <p>
            Click <strong>Edit</strong> on any deck to open it in a Collabora
            Online (LibreOffice Impress) editor inside the browser. Make
            manual tweaks, save, and the deck stays version-controlled. Useful
            for adjustments the agent didn&apos;t quite get right, or for
            adding a footer the agent didn&apos;t know about.
          </p>
        </section>

        <section id="find" className="docs-section">
          <h2 className="text-2xl font-semibold tracking-tight">Slide Finder</h2>
          <p>
            Open <strong>Find</strong> from the left sidebar. It indexes every
            slide of every deck you&apos;ve uploaded — text, dominant colours,
            visual elements — so you can search across all your decks for
            &quot;our customer logos slide,&quot; &quot;the quarterly revenue
            chart,&quot; or &quot;that slide with the green hexagons.&quot;
            Useful when you&apos;ve got a corpus of past decks and want to pull
            a specific layout.
          </p>
        </section>

        {/* ───────────────────────── REST API ───────────────────────── */}
        <section id="api-overview" className="docs-section">
          <span className="docs-eyebrow">REST API</span>
          <h2 className="text-2xl font-semibold tracking-tight">Overview</h2>
          <p>
            Every feature in the GUI is also a REST endpoint at{" "}
            <code>/api/v1/…</code>. Auth is a <code>psf_…</code> bearer token
            you mint in <Link href="/settings" className="docs-link">Settings → Developer</Link>.
            Generation is async: <code>POST /v1/decks</code> returns a job ID
            you poll or stream until the deck is ready, then download via a
            short-lived presigned URL.
          </p>
          <p>
            For an interactive playground with try-it buttons, head to{" "}
            <Link href="/docs/api" className="docs-link">
              /docs/api <ExternalLink className="h-3 w-3 inline" />
            </Link>{" "}
            (Scalar). The raw OpenAPI 3.1 spec is at{" "}
            <a href="/api/openapi.json" className="docs-link">/api/openapi.json</a>{" "}
            — drop that into Postman, Insomnia, or any code generator.
          </p>
        </section>

        <section id="auth" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Authentication</h3>
          <p>
            All v1 endpoints require <code>Authorization: Bearer psf_…</code>.
            Mint a key from <Link href="/settings" className="docs-link">Settings → Developer</Link>.
            Treat each key like a password — anyone holding it can call the
            API on your behalf.
          </p>
          <p className="mt-3">
            Two prerequisites for minting <em>or</em> using a key:
          </p>
          <ul className="docs-list">
            <li>You have at least one provider API key configured (OpenAI / Anthropic / Mistral / Gemini), <em>or</em></li>
            <li>You&apos;ve redeemed a coupon that grants unlimited use.</li>
          </ul>
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/style-profiles \\
  -H "Authorization: Bearer psf_Y58n7loc..."`} />
        </section>

        <section id="concepts" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Async jobs &amp; idempotency</h3>
          <p>
            Deck generation takes 60–120s and runs as a background job. Every
            create/edit endpoint returns <code>202 Accepted</code> with a{" "}
            <code>jobId</code>. Two ways to wait for completion:
          </p>
          <ul className="docs-list">
            <li>
              <strong>Polling</strong>: <code>GET /v1/jobs/{`{id}`}</code> every
              ~2s. Easy from anywhere; no long-lived connection needed.
            </li>
            <li>
              <strong>Streaming</strong>:{" "}
              <code>GET /v1/jobs/{`{id}`}/stream</code> opens a Server-Sent
              Events channel and pushes phase updates until the job ends.
              Better UX for end-user-facing flows.
            </li>
          </ul>
          <p>
            Send an <code>Idempotency-Key</code> header on POST requests to
            make retries safe. Same key + same bearer = the original response,
            cached for 24 hours, even if the body differs.
          </p>
          <Code
            lang="bash"
            code={`curl -X POST https://presoai.stallion-ai.in/api/v1/decks \\
  -H "Authorization: Bearer psf_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"prompt":"4-slide pitch for our agentic ITOps platform","numSlides":4}'`}
          />
        </section>

        <section id="rate-limits" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Rate limits</h3>
          <p>Two budgets per API key, both implemented as Redis sliding windows:</p>
          <ul className="docs-list">
            <li><strong>60 requests / minute</strong> across all endpoints.</li>
            <li><strong>600 requests / hour</strong> across all endpoints.</li>
            <li><strong>10 deck-create or edit calls / hour</strong> (the &quot;expensive&quot; budget — covers anything that kicks off a generation job).</li>
          </ul>
          <p>
            On a 429 response, headers tell you exactly how long to wait:
          </p>
          <Code lang="http" code={`HTTP/1.1 429 Too Many Requests
Retry-After: 47
X-RateLimit-Limit-Minute: 60
X-RateLimit-Remaining-Minute: 0
X-RateLimit-Limit-Hour: 600
X-RateLimit-Remaining-Hour: 412`} />
        </section>

        <section id="errors" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Error codes</h3>
          <p>
            Every error response is JSON of shape{" "}
            <code>{`{"error":{"code","message","details?"}}`}</code>. Common codes:
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/60 mt-3">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Code</th>
                  <th className="text-left px-3 py-2 font-medium">HTTP</th>
                  <th className="text-left px-3 py-2 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <ErrRow c="missing_bearer"        h="401" m="Authorization header missing or not a Bearer token." />
                <ErrRow c="invalid_key"           h="401" m="Bearer token doesn't match any active API key." />
                <ErrRow c="key_revoked"           h="403" m="Key was deleted from Settings → Developer." />
                <ErrRow c="key_expired"           h="403" m="Key passed its expiry date." />
                <ErrRow c="entitlement_required" h="403" m="Account has no provider key and no redeemed coupon. Add one to use the API." />
                <ErrRow c="rate_limited"          h="429" m="Hit per-minute, per-hour, or expensive-per-hour budget." />
                <ErrRow c="validation_failed"     h="400" m="Body or query failed Zod validation. Check `details`." />
                <ErrRow c="invalid_json"          h="400" m="Body wasn't valid JSON." />
                <ErrRow c="no_model_available"    h="400" m="No usable LLM resolved. Add a provider key or pass `model` in body." />
                <ErrRow c="unsupported_media_type" h="415" m="Content-Type not allowed for the chosen file purpose." />
                <ErrRow c="file_too_large"        h="413" m="Direct upload &gt; 25 MB. Use the presigned-URL flow." />
                <ErrRow c="deck_not_found"        h="404" m="Deck doesn't exist or doesn't belong to this account." />
                <ErrRow c="job_not_found"         h="404" m="Job doesn't exist or doesn't belong to this account." />
                <ErrRow c="deck_not_editable"     h="422" m="Deck has no editable slide source. Regenerate it first." />
                <ErrRow c="dispatch_failed"       h="503" m="Couldn't enqueue the job (Redis/queue issue). Retry shortly." />
                <ErrRow c="internal_error"        h="500" m="Unhandled error. Logs server-side; safe to retry." />
              </tbody>
            </table>
          </div>
        </section>

        {/* ───────────────────────── Endpoints ───────────────────────── */}
        <section id="ep-create-deck" className="docs-section">
          <span className="docs-eyebrow">Endpoints</span>
          <Endpoint
            method="POST"
            path="/v1/decks"
            summary="Create a deck"
            description="Async. Returns 202 Accepted with a jobId — poll or stream until the deck is ready."
            body
          />
          <Code lang="bash" code={`curl -X POST https://presoai.stallion-ai.in/api/v1/decks \\
  -H "Authorization: Bearer psf_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 9b1b9f..." \\
  -d '{
    "prompt": "Build a 4-slide pitch deck for our agentic ITOps platform aimed at Fortune 500 banks.",
    "numSlides": 4,
    "audienceType": "executive",
    "engine": "node-worker",
    "creativeMode": true,
    "styleProfileId": "cmovujk7o0005gupq5qfb8n56"
  }'`} />
          <Code lang="json" code={`{
  "jobId": "cmoxg2jil0005145i0bm82tqq",
  "deckId": "cmoxfvztp000875pss1bsrr47",
  "status": "queued",
  "statusUrl": "https://presoai.stallion-ai.in/api/v1/jobs/cmoxg2jil0005145i0bm82tqq",
  "streamUrl": "https://presoai.stallion-ai.in/api/v1/jobs/cmoxg2jil0005145i0bm82tqq/stream"
}`} />
          <FieldTable
            rows={[
              { name: "prompt",            type: "string",    req: true,  desc: "What the deck is about. Audience hints, ask, and tone all go here." },
              { name: "numSlides",         type: "integer",   req: true,  desc: "1–15." },
              { name: "audienceType",      type: "enum",      req: false, desc: "executive | technical | general | marketing. Default: general." },
              { name: "engine",            type: "enum",      req: false, desc: "preso-pro | node-worker | preso-plus. Default: node-worker (Preso Elite)." },
              { name: "creativeMode",      type: "boolean",   req: false, desc: "Pushes the agent toward unconventional layouts. Default: false." },
              { name: "useDiagramImages",  type: "boolean",   req: false, desc: "Render complex diagrams as images via Kroki. Default: false." },
              { name: "useImageGen",       type: "boolean",   req: false, desc: "Allow Gemini Nano Banana photo backgrounds on cover + section dividers. Default: false." },
              { name: "styleProfileId",    type: "string",    req: false, desc: "Lock the deck to a brand style. See GET /v1/style-profiles." },
              { name: "referenceFileKeys", type: "string[]",  req: false, desc: "S3 keys from POST /v1/files." },
              { name: "chatImageKeys",     type: "string[]",  req: false, desc: "Vision-input image S3 keys." },
              { name: "model",             type: "object",    req: false, desc: "Per-request LLM override: { provider, model, apiKey }. Provider must be openai/anthropic/google/mistral." },
              { name: "name",              type: "string",    req: false, desc: "Optional project name; auto-derived from prompt if omitted." },
            ]}
          />
        </section>

        <section id="ep-get-job" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/jobs/{id}"
            summary="Poll a job"
            description="Returns the latest known status, phase, progress, and (when ready) the presentation ID + 1-hour presigned download URL."
          />
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/jobs/JOB_ID \\
  -H "Authorization: Bearer psf_…"`} />
          <Code lang="json" code={`{
  "jobId": "cmoxg2jil0005145i0bm82tqq",
  "deckId": "cmoxfvztp000875pss1bsrr47",
  "status": "succeeded",
  "phase": "complete",
  "progress": 1,
  "message": "Presentation ready!",
  "presentationId": "cmoxhfn7z0007145i0f2qrvfu",
  "downloadUrl": "https://minio.preso.example/...&signature=...",
  "slideCount": 4,
  "createdAt": "2026-05-08T22:24:13.399Z",
  "completedAt": "2026-05-08T22:25:46.121Z"
}`} />
          <p className="text-sm text-muted-foreground italic">
            <strong>status</strong> values: <code>queued</code>, <code>processing</code>,
            <code>succeeded</code>, <code>failed</code>. Poll roughly every 2s; stop when terminal.
          </p>
        </section>

        <section id="ep-stream-job" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/jobs/{id}/stream"
            summary="Stream job progress (SSE)"
            description="Server-Sent Events. Each `data:` line is a JSON object with phase / progress / message. Stream ends with phase=complete or phase=failed."
          />
          <Code lang="bash" code={`curl -N https://presoai.stallion-ai.in/api/v1/jobs/JOB_ID/stream \\
  -H "Authorization: Bearer psf_…"`} />
          <Code lang="text" code={`data: {"phase":"queued","progress":0,"message":"Connected to job …"}

data: {"phase":"researching","progress":0.25,"message":"Generating research queries…"}

data: {"phase":"writing_slides","progress":0.7,"message":"Designing slides with Creative Mode…"}

data: {"phase":"complete","progress":1,"message":"Presentation ready!","data":{"s3Key":"…","slideCount":4}}`} />
          <p className="text-sm text-muted-foreground italic">
            JS example using <code>EventSource</code>:
          </p>
          <Code lang="js" code={`const url = new URL("https://presoai.stallion-ai.in/api/v1/jobs/" + jobId + "/stream");
const ev = new EventSource(url, {
  headers: { Authorization: "Bearer psf_…" } // requires the EventSourcePolyfill on browsers
});
ev.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  console.log(evt.phase, evt.progress, evt.message);
  if (evt.phase === "complete" || evt.phase === "failed") ev.close();
};`} />
        </section>

        <section id="ep-edit-deck" className="docs-section">
          <Endpoint
            method="POST"
            path="/v1/decks/{id}/edit"
            summary="Surgically edit an existing deck"
            description="Patches only the slides affected by your instruction. Same async contract as create."
            body
          />
          <Code lang="bash" code={`curl -X POST https://presoai.stallion-ai.in/api/v1/decks/DECK_ID/edit \\
  -H "Authorization: Bearer psf_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "instruction": "Change slide 3 to a bar chart instead of stat cards. Tighten the cover subtitle.",
    "targetSlides": [1, 3]
  }'`} />
          <FieldTable
            rows={[
              { name: "instruction",   type: "string",   req: true,  desc: "Plain-English description of what to change. Be specific about which slide(s) when possible." },
              { name: "targetSlides", type: "integer[]", req: false, desc: "Hint at which slide numbers to focus on." },
              { name: "model",         type: "object",   req: false, desc: "Same per-request LLM override as POST /v1/decks." },
            ]}
          />
        </section>

        <section id="ep-get-deck" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/decks/{id}"
            summary="Get deck metadata"
            description="Project info plus a version list of all rendered presentations for this deck."
          />
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/decks/DECK_ID \\
  -H "Authorization: Bearer psf_…"`} />
        </section>

        <section id="ep-download-deck" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/decks/{id}/download"
            summary="Get a presigned download URL"
            description="Returns a short-lived (1h) URL to the latest rendered .pptx, or a specific version with ?version=N."
          />
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/decks/DECK_ID/download?version=2 \\
  -H "Authorization: Bearer psf_…"`} />
        </section>

        <section id="ep-files" className="docs-section">
          <Endpoint
            method="POST"
            path="/v1/files"
            summary="Upload a reference file"
            description="Two modes — direct multipart (≤ 25 MB) or presigned URL (≤ 100 MB). Returns an s3Key you can pass to /v1/decks."
            body
          />
          <p className="text-sm text-muted-foreground italic mt-2">Direct upload (multipart):</p>
          <Code lang="bash" code={`curl -X POST https://presoai.stallion-ai.in/api/v1/files \\
  -H "Authorization: Bearer psf_…" \\
  -F "file=@./reference-deck.pptx" \\
  -F "purpose=reference"`} />
          <p className="text-sm text-muted-foreground italic mt-4">Presigned URL (large files):</p>
          <Code lang="bash" code={`curl -X POST https://presoai.stallion-ai.in/api/v1/files \\
  -H "Authorization: Bearer psf_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fileName":"big-deck.pptx",
    "contentType":"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "purpose":"reference"
  }'

# then PUT the bytes to uploadUrl from the response within 10 minutes:
curl -X PUT "$UPLOAD_URL" --data-binary @./big-deck.pptx \\
  -H "Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation"`} />
        </section>

        <section id="ep-style-profiles" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/style-profiles"
            summary="List available brand styles"
          />
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/style-profiles \\
  -H "Authorization: Bearer psf_…"`} />
        </section>

        <section id="ep-llm-configs" className="docs-section">
          <Endpoint
            method="GET"
            path="/v1/llm-configs"
            summary="List available LLM models"
            description="Tells you which models are configured and which providers you have stored keys for — so you know whether you need to pass model.apiKey in /v1/decks calls."
          />
          <Code lang="bash" code={`curl https://presoai.stallion-ai.in/api/v1/llm-configs \\
  -H "Authorization: Bearer psf_…"`} />
        </section>

        {/* ───────────────────────── MCP server ───────────────────────── */}
        <section id="mcp-overview" className="docs-section">
          <span className="docs-eyebrow">MCP server</span>
          <h2 className="text-2xl font-semibold tracking-tight">Model Context Protocol</h2>
          <p>
            Preso speaks <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer noopener" className="docs-link">
              Model Context Protocol <ExternalLink className="h-3 w-3 inline" />
            </a>. The server is a thin wrapper over the v1 REST API that exposes
            seven tools any MCP-aware client can call: Claude Desktop, Cursor,
            Zed, Continue, n8n, your own agent. Same auth, same rate limits,
            same audit log.
          </p>
          <p>
            <strong>Endpoint:</strong> <code>https://presoai.stallion-ai.in/mcp</code>.
            Transport is{" "}
            <strong>Streamable HTTP</strong> — the protocol's current
            recommendation for remote MCP. Long-running tools like{" "}
            <code>create_deck</code> emit <code>notifications/progress</code>{" "}
            events mid-call so the client can render a live narration the same
            way the dashboard does.
          </p>
        </section>

        <section id="mcp-auth" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Authentication</h3>
          <p>
            Auth is four HTTP headers on the MCP connection. Set them once in
            your client config; they apply to every tool call until the
            session ends. The server never persists the provider key — it
            lives in memory for the connection's lifetime only.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/60 mt-3">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Header</th>
                  <th className="text-left px-3 py-2 font-medium">Required</th>
                  <th className="text-left px-3 py-2 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <tr>
                  <td className="px-3 py-2"><code className="text-xs">Authorization: Bearer psf_…</code></td>
                  <td className="px-3 py-2 text-xs text-rose-500">always</td>
                  <td className="px-3 py-2 text-xs">Preso identity. Mint in <Link href="/settings" className="docs-link">Settings → Developer</Link>.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2"><code className="text-xs">X-Preso-Provider</code></td>
                  <td className="px-3 py-2 text-xs text-rose-500">always</td>
                  <td className="px-3 py-2 text-xs">One of <code>openai</code>, <code>anthropic</code>, <code>google</code>, <code>mistral</code>.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2"><code className="text-xs">X-Preso-Provider-Key</code></td>
                  <td className="px-3 py-2 text-xs">unless google</td>
                  <td className="px-3 py-2 text-xs">Your provider's API key. Held in memory only. Optional for Google because the server has a fallback.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2"><code className="text-xs">X-Preso-Model</code></td>
                  <td className="px-3 py-2 text-xs">optional</td>
                  <td className="px-3 py-2 text-xs">Specific model id. Default per-provider applies if omitted.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground italic mt-3">
            On connect, the server makes one cheap round-trip to validate
            your bearer + entitlement (provider key or coupon required, same
            rule as the REST API). If anything's wrong you get a clear error
            at connect time — no surprises mid-conversation.
          </p>
        </section>

        <section id="mcp-tools" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Tools</h3>
          <p>Seven tools, all natively schema-typed via <code>tools/list</code>:</p>
          <div className="overflow-x-auto rounded-lg border border-border/60 mt-3">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Tool</th>
                  <th className="text-left px-3 py-2 font-medium">What it does</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">create_deck</code></td>
                  <td className="px-3 py-2 text-xs">Generate a deck. Long-running, emits progress events. Returns a 1-hour presigned <code>downloadUrl</code>.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">edit_deck</code></td>
                  <td className="px-3 py-2 text-xs">Surgically edit an existing deck. Same async + progress pattern.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">get_deck_status</code></td>
                  <td className="px-3 py-2 text-xs">Non-blocking job-status check. Useful if the agent already kicked off a long job.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">list_decks</code></td>
                  <td className="px-3 py-2 text-xs">Recent decks for this account, cursor-paginated.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">list_style_profiles</code></td>
                  <td className="px-3 py-2 text-xs">Available brand styles (the user's + the platform globals: IBM/ICICI/Wipro).</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">download_deck</code></td>
                  <td className="px-3 py-2 text-xs">Mint a fresh presigned URL for a deck (or specific version).</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 align-top"><code className="text-xs">upload_file</code></td>
                  <td className="px-3 py-2 text-xs">Get a presigned PUT URL for a reference deck or vision-input image. Returns the <code>s3Key</code> to pass into <code>create_deck</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground italic mt-3">
            All schemas are advertised over <code>tools/list</code> so MCP-aware
            clients render them automatically. No manual schema authoring on
            the agent side.
          </p>
        </section>

        <section id="mcp-claude-desktop" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Claude Desktop</h3>
          <p>
            Edit your Claude Desktop config (
            <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
            on macOS, similar paths on Windows/Linux):
          </p>
          <Code lang="json" code={`{
  "mcpServers": {
    "preso": {
      "url": "https://presoai.stallion-ai.in/mcp",
      "headers": {
        "Authorization": "Bearer psf_YOUR_KEY",
        "X-Preso-Provider": "google",
        "X-Preso-Provider-Key": "YOUR_GEMINI_KEY",
        "X-Preso-Model": "gemini-2.5-pro"
      }
    }
  }
}`} />
          <p className="text-sm text-muted-foreground italic mt-3">
            Restart Claude Desktop. In a new chat you&apos;ll see Preso in the
            tools panel — try &quot;Generate a 6-slide deck about renewable
            energy for high-school students.&quot; You&apos;ll see the live
            phase narration as Claude calls <code>create_deck</code>, then
            the download URL appears in the response.
          </p>
        </section>

        <section id="mcp-cursor" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Cursor</h3>
          <p>
            Add to <code>~/.cursor/mcp.json</code> (or via Cursor → Settings → MCP):
          </p>
          <Code lang="json" code={`{
  "mcpServers": {
    "preso": {
      "url": "https://presoai.stallion-ai.in/mcp",
      "headers": {
        "Authorization": "Bearer psf_YOUR_KEY",
        "X-Preso-Provider": "anthropic",
        "X-Preso-Provider-Key": "sk-ant-…",
        "X-Preso-Model": "claude-sonnet-4-6"
      }
    }
  }
}`} />
          <p className="text-sm text-muted-foreground italic mt-3">
            Cursor&apos;s MCP picker shows the seven tools immediately. Use them
            from any chat with Composer.
          </p>
        </section>

        <section id="mcp-n8n" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">n8n</h3>
          <p>
            n8n&apos;s <em>MCP Client</em> node accepts a Streamable HTTP URL
            and headers. Drop the same four headers into the node&apos;s
            <em> Headers</em> section, point the URL at{" "}
            <code>https://presoai.stallion-ai.in/mcp</code>, and the workflow
            can call any of the seven tools. Useful for batched deck
            generation triggered by spreadsheets, forms, or webhooks.
          </p>
        </section>

        <section id="mcp-custom" className="docs-section">
          <h3 className="text-xl font-semibold tracking-tight">Custom client</h3>
          <p>
            Any MCP SDK works. Quick TypeScript example using{" "}
            <code>@modelcontextprotocol/sdk</code>:
          </p>
          <Code lang="ts" code={`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(new URL("https://presoai.stallion-ai.in/mcp"), {
  requestInit: {
    headers: {
      Authorization: "Bearer psf_YOUR_KEY",
      "X-Preso-Provider": "google",
      "X-Preso-Provider-Key": "YOUR_GEMINI_KEY",
      "X-Preso-Model": "gemini-2.5-pro",
    },
  },
});
const client = new Client({ name: "my-agent", version: "1.0" }, { capabilities: {} });
await client.connect(transport);

// Optional: subscribe to progress notifications.
client.fallbackNotificationHandler = async (n) => {
  if (n.method === "notifications/progress") {
    const p = n.params;
    console.log(\`progress: \${Math.round((p.progress / (p.total ?? 1)) * 100)}%\`);
  }
};

const result = await client.callTool({
  name: "create_deck",
  arguments: {
    prompt: "4-slide pitch for an ITOps platform aimed at Fortune 500 banks.",
    numSlides: 4,
    audienceType: "executive",
    creativeMode: true,
  },
});
console.log(result.content[0].text);  // JSON with downloadUrl
await client.close();`} />
          <p className="text-sm text-muted-foreground italic mt-3">
            For Python, use the equivalent from{" "}
            <code>mcp.client.streamable_http</code>. The protocol is identical
            — same four headers, same tool surface.
          </p>
        </section>

        {/* ───────────────────────── More ───────────────────────── */}
        <section id="openapi" className="docs-section">
          <span className="docs-eyebrow">More</span>
          <h2 className="text-2xl font-semibold tracking-tight">OpenAPI spec</h2>
          <p>
            The full machine-readable spec is at{" "}
            <a href="/api/openapi.json" className="docs-link">
              /api/openapi.json
            </a>
            . Import it into Postman, Insomnia, or Stoplight, or feed it into
            an SDK generator. The interactive playground at{" "}
            <Link href="/docs/api" className="docs-link">
              /docs/api
            </Link>{" "}
            renders the same spec with try-it buttons.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/docs/api">
              <Button size="sm" className="gap-1.5">
                <Code2 className="h-3.5 w-3.5" />
                Open API Explorer
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
            <a href="/api/openapi.json" target="_blank" rel="noreferrer noopener">
              <Button size="sm" variant="outline" className="gap-1.5">
                Download OpenAPI JSON
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </section>
      </DocsClient>

      <footer className="border-t border-border/60 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <PresoLogo size="sm" />
          <p className="text-xs text-muted-foreground">
            <a href="/api/openapi.json" className="docs-link">openapi.json</a>
            <span className="mx-2">·</span>
            <Link href="/docs/api" className="docs-link">API Explorer</Link>
            <span className="mx-2">·</span>
            <Link href="/" className="docs-link">Home</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

// ─── Inline helpers — kept in this file so the page is self-contained ──────

function FeatureBlurb({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function EngineCard({ name, body, tag }: { name: string; body: string; tag?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <p className="text-sm font-semibold">{name}</p>
        {tag && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
            {tag}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Code({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden mt-4">
      <div className="px-3 py-1.5 border-b border-border/40 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{lang}</span>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[12.5px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Endpoint({ method, path, summary, description, body }: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  summary: string;
  description?: string;
  body?: boolean;
}) {
  const methodClass = method === "POST"
    ? "bg-emerald-500/15 text-emerald-600"
    : method === "DELETE"
      ? "bg-rose-500/15 text-rose-600"
      : "bg-blue-500/15 text-blue-600";
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${methodClass}`}>
          {method}
        </span>
        <code className="text-sm font-semibold">{path}</code>
        {body && <span className="text-[10px] text-muted-foreground">JSON body</span>}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{summary}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </>
  );
}

function FieldTable({ rows }: {
  rows: Array<{ name: string; type: string; req: boolean; desc: string }>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 mt-4">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Field</th>
            <th className="text-left px-3 py-2 font-medium">Type</th>
            <th className="text-left px-3 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-3 py-2 align-top">
                <code className="text-xs">{r.name}</code>
                {r.req && <span className="ml-1.5 text-[9px] uppercase font-semibold text-rose-500">required</span>}
              </td>
              <td className="px-3 py-2 align-top">
                <code className="text-xs text-muted-foreground">{r.type}</code>
              </td>
              <td className="px-3 py-2 align-top text-xs leading-relaxed">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrRow({ c, h, m }: { c: string; h: string; m: string }) {
  return (
    <tr>
      <td className="px-3 py-2 align-top"><code className="text-xs">{c}</code></td>
      <td className="px-3 py-2 align-top text-xs text-muted-foreground">{h}</td>
      <td className="px-3 py-2 align-top text-xs leading-relaxed">{m}</td>
    </tr>
  );
}
