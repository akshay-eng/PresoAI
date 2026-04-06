"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Brain,
  Palette,
  Globe,
  Users,
  BarChart3,
  FileText,
  Zap,
  ArrowRight,
  Layers,
  Upload,
  Sparkles,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PresoLogo } from "@/components/preso-logo";

const ease = [0.22, 1, 0.36, 1] as const;

const features = [
  { icon: Brain, title: "Multi-LLM Support", desc: "OpenAI, Claude, Gemini, Mistral, or bring your own endpoint." },
  { icon: Palette, title: "Template Themes", desc: "Upload .pptx templates to match your brand identity." },
  { icon: Globe, title: "Web Research", desc: "AI searches the web for up-to-date, relevant information." },
  { icon: Users, title: "Human-in-the-Loop", desc: "Review and edit outlines before generation begins." },
  { icon: BarChart3, title: "Charts & Data", desc: "Auto-generated charts from structured data sources." },
  { icon: FileText, title: "Speaker Notes", desc: "AI-written speaker notes for every single slide." },
  { icon: Layers, title: "PowerPoint & Canva", desc: "Open in PowerPoint Online or edit directly in Canva." },
  { icon: Zap, title: "Real-time Progress", desc: "Watch your presentation being built live, step by step." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex h-14 items-center justify-between px-6">
          <Link href="/">
            <PresoLogo size="md" />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/auth/register">
              <Button size="sm">
                Get Started
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — asymmetric, left-aligned */}
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
            >
              <p className="text-sm font-medium text-primary mb-4">
                AI-powered presentation generation
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.15] text-foreground">
                Create enterprise decks
                <br />
                in minutes, not hours
              </h1>
              <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-lg">
                Describe your topic, upload your brand template, and let AI
                research, plan, and generate a polished PowerPoint. Review the
                outline before a single slide is written.
              </p>
              <div className="mt-8 flex items-center gap-3">
                <Link href="/auth/register">
                  <Button size="lg" className="h-11 px-6">
                    Start Creating
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/auth/login">
                  <Button size="lg" variant="outline" className="h-11 px-6">
                    Sign In
                  </Button>
                </Link>
              </div>
            </motion.div>

            {/* Product preview — not a 3D card, just a clean screenshot mock */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease }}
              className="hidden lg:block"
            >
              <div className="rounded-xl border border-border bg-card p-1.5">
                <div className="rounded-lg bg-muted overflow-hidden">
                  {/* Toolbar mock */}
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-accent/60" />
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="h-5 w-20 rounded bg-secondary" />
                      <div className="h-5 w-5 rounded bg-primary/20" />
                    </div>
                  </div>
                  {/* Content area mock */}
                  <div className="p-6 grid grid-cols-12 gap-4 min-h-[280px]">
                    <div className="col-span-3 space-y-3">
                      <div className="h-2 w-14 rounded bg-muted-foreground/15" />
                      <div className="rounded-lg border border-dashed border-border p-3 flex flex-col items-center gap-1.5">
                        <Upload className="h-4 w-4 text-muted-foreground/30" />
                        <div className="h-1.5 w-12 rounded bg-muted-foreground/10" />
                      </div>
                      <div className="h-2 w-10 rounded bg-muted-foreground/15" />
                      <div className="h-7 rounded bg-secondary" />
                    </div>
                    <div className="col-span-6 space-y-3">
                      <div className="h-2 w-32 rounded bg-muted-foreground/15" />
                      <div className="rounded-lg bg-secondary/50 p-3 space-y-1.5">
                        <div className="h-1.5 w-full rounded bg-muted-foreground/10" />
                        <div className="h-1.5 w-4/5 rounded bg-muted-foreground/10" />
                        <div className="h-1.5 w-3/5 rounded bg-muted-foreground/10" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="h-8 rounded bg-secondary/50" />
                        <div className="h-8 rounded bg-secondary/50" />
                      </div>
                      <div className="h-9 rounded-lg bg-primary flex items-center justify-center">
                        <Sparkles className="h-3 w-3 text-primary-foreground" />
                      </div>
                    </div>
                    <div className="col-span-3 space-y-2">
                      <div className="h-2 w-16 rounded bg-muted-foreground/15" />
                      {[70, 100, 40].map((w, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${i < 2 ? "bg-green-400/60" : "bg-muted-foreground/20"}`} />
                          <div className="h-1.5 rounded bg-muted-foreground/10" style={{ width: `${w}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* How it works — stepped, not identical cards */}
        <section className="border-t border-border/60 py-24">
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease }}
            >
              <p className="text-sm font-medium text-primary mb-2">How it works</p>
              <h2 className="text-2xl sm:text-3xl font-bold">Three steps to a finished deck</h2>
            </motion.div>

            <div className="mt-14 space-y-12 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-8">
              {[
                {
                  step: "01",
                  title: "Describe your topic",
                  body: "Enter what your presentation is about, who the audience is, and how many slides you need. Upload reference documents and a .pptx template to keep your brand consistent.",
                  icon: FileText,
                },
                {
                  step: "02",
                  title: "Review the outline",
                  body: "AI researches your topic using the web and your references, then proposes a slide-by-slide outline. Edit titles, reorder, or reject before anything is generated.",
                  icon: CheckCircle,
                },
                {
                  step: "03",
                  title: "Download and share",
                  body: "Get a polished .pptx with your theme, auto-generated charts, and speaker notes. Open directly in PowerPoint or edit in Canva.",
                  icon: ArrowRight,
                },
              ].map((s, i) => (
                <motion.div
                  key={s.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5, ease }}
                  className="relative"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary shrink-0">
                      <s.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Step {s.step}</p>
                      <h3 className="text-base font-semibold mb-2">{s.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Features — varied grid, not identical cards */}
        <section className="py-24">
          <div className="max-w-6xl mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease }}
              className="mb-12"
            >
              <p className="text-sm font-medium text-primary mb-2">Features</p>
              <h2 className="text-2xl sm:text-3xl font-bold max-w-md">
                Everything you need to build better decks
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border/40 rounded-xl overflow-hidden border border-border/40">
              {features.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04, duration: 0.4 }}
                  className="bg-background p-5 flex flex-col gap-3 transition-colors duration-200 hover:bg-card"
                >
                  <f.icon className="h-4.5 w-4.5 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA — simple, warm, no gradient box */}
        <section className="py-24 border-t border-border/60">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease }}
            className="max-w-xl mx-auto px-6 text-center"
          >
            <h2 className="text-2xl sm:text-3xl font-bold">
              Ready to build your next deck?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Stop spending hours on slides. Let AI do the research and
              generation while you focus on the story.
            </p>
            <div className="mt-8">
              <Link href="/auth/register">
                <Button size="lg" className="h-11 px-8">
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-border/60 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PresoLogo size="sm" />
          </div>
          <p className="text-xs text-muted-foreground">
            AI-Powered Presentation Generation
          </p>
        </div>
      </footer>
    </div>
  );
}
