import Link from "next/link";
import Script from "next/script";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresoLogo } from "@/components/preso-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "API Explorer · Preso",
  description: "Interactive REST API reference for Preso. Try-it console, schemas, and code samples.",
};

/**
 * Interactive API reference rendered by Scalar — a modern OpenAPI viewer
 * loaded from CDN so we don't take an npm dependency. Reads the spec from
 * /api/openapi.json (public route).
 *
 * Why Scalar over Swagger UI: Scalar is significantly faster, has nicer
 * built-in code-sample generation (curl, JS fetch, Python, Go), supports
 * dark mode out of the box, and ships in ~80KB gzipped.
 */
export default function DocsApiPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <PresoLogo size="md" />
            </Link>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground border-l border-border pl-3">
              API Explorer
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/docs">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to docs
              </Button>
            </Link>
            <ThemeToggle />
            <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />
            <a href="/api/openapi.json" target="_blank" rel="noreferrer noopener">
              <Button variant="outline" size="sm" className="gap-1.5">
                Raw OpenAPI JSON
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/*
          Scalar reads its config from data-* attrs on <#api-reference> at
          boot. We render those attrs directly in JSX so SSR and the client
          produce identical HTML — that's why this is NOT a Script tag that
          mutates the DOM (the previous version caused a hydration mismatch).

          The Scalar bundle is loaded as a deferred CDN script; it picks up
          the data attributes when it parses, no extra config needed.
        */}
        <div
          id="api-reference"
          data-url="/api/openapi.json"
          data-configuration={JSON.stringify({
            theme: "purple",
            hideDownloadButton: false,
            hideTestRequestButton: false,
            searchHotKey: "k",
            metaData: {
              title: "Preso REST API",
              description: "Generate enterprise PowerPoint decks programmatically.",
            },
          })}
        />
        <Script
          src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
          strategy="afterInteractive"
        />
      </main>
    </div>
  );
}
