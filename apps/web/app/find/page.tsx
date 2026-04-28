"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Sparkles, FileText, Clock } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const ease = [0.22, 1, 0.36, 1] as const;

export default function FindPage() {
  useSession({ required: true });

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searching, setSearching] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmittedQuery(query.trim());
    setSearching(true);
    // Simulate search — backend functionality to be implemented
    setTimeout(() => setSearching(false), 800);
  }

  const hasResults = submittedQuery.length > 0;

  return (
    <div className="min-h-screen flex relative">
      <AppSidebar />

      <main className="flex-1 ml-[72px]">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="max-w-3xl mx-auto pt-20 pb-10 px-6"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Search className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
              Find
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Find your slide
          </h1>
          <p className="text-sm text-muted-foreground mb-8 max-w-xl">
            Search across all your decks to find the exact slide you need —
            by title, content, or topic.
          </p>

          {/* Search form */}
          <form onSubmit={handleSearch}>
            <div className="rounded-xl border border-border/60 bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:border-border">
              <div className="flex items-center gap-2 px-3 py-2">
                <Search className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                <Input
                  type="text"
                  placeholder="Search slides by title, content, or keyword..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm placeholder:text-muted-foreground/50"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!query.trim() || searching}
                  className="h-8 px-3 text-xs"
                >
                  {searching ? "Searching..." : "Search"}
                </Button>
              </div>
            </div>
          </form>

          {/* Quick filters */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["All decks", "This week", "Has charts", "Has diagrams", "Executive"].map(
              (filter) => (
                <button
                  key={filter}
                  type="button"
                  className="text-[10px] rounded-md border border-border/60 bg-secondary/30 px-2 py-1 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  {filter}
                </button>
              )
            )}
          </div>
        </motion.div>

        {/* Results */}
        <div className="max-w-5xl mx-auto px-6 pb-16">
          <AnimatePresence mode="wait">
            {!hasResults && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="text-center py-16"
              >
                <div className="inline-flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-2xl bg-muted/40 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Search across your decks</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Try queries like &ldquo;Q3 revenue&rdquo;, &ldquo;architecture diagram&rdquo;, or
                      &ldquo;onboarding flow&rdquo; to find the slide you need.
                    </p>
                  </div>
                </div>

                {/* Suggested queries */}
                <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
                  {[
                    "Architecture diagrams",
                    "KPI dashboards",
                    "Roadmap slides",
                    "Comparison tables",
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setQuery(s);
                        setSubmittedQuery(s);
                        setSearching(true);
                        setTimeout(() => setSearching(false), 800);
                      }}
                      className="text-xs rounded-lg border border-border/60 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {hasResults && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease }}
                className="space-y-4"
              >
                {/* Results header */}
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm">
                    {searching ? (
                      <span className="text-muted-foreground">
                        Searching for &ldquo;{submittedQuery}&rdquo;...
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">0 results</span>{" "}
                        <span className="text-muted-foreground">
                          for &ldquo;{submittedQuery}&rdquo;
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {/* Loading skeletons */}
                {searching && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-border/60 bg-card p-3 space-y-2"
                      >
                        <Skeleton className="aspect-[16/10] w-full rounded-md" />
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2 w-1/2" />
                      </div>
                    ))}
                  </div>
                )}

                {/* No results state (real data not wired yet) */}
                {!searching && (
                  <div className="rounded-xl border border-dashed border-border/60 bg-card/50 p-12 text-center">
                    <div className="inline-flex flex-col items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">No matching slides yet</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                          Slide search will scan titles, content, and speaker notes across all
                          your projects. Backend coming soon.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent searches strip — UI-only placeholder */}
                {!searching && (
                  <div className="pt-8">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                      <Clock className="h-3 w-3" />
                      Recent
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {["fraud detection", "microservices migration", "Q4 OKRs"].map(
                        (r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => {
                              setQuery(r);
                              setSubmittedQuery(r);
                              setSearching(true);
                              setTimeout(() => setSearching(false), 800);
                            }}
                            className="text-[10px] rounded-md bg-secondary/40 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {r}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
