"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Search, Palette, Sparkles, Users, Globe, Building2, Banknote,
  Briefcase, GraduationCap, Heart, ShoppingBag, Factory, Megaphone,
  HandHeart, Layers, Loader2, X, Plus, Check, ExternalLink,
} from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ease = [0.22, 1, 0.36, 1] as const;

type CatalogStyle = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  isGlobal: boolean;
  isPublic: boolean;
  themeConfig: Record<string, unknown> | null;
  thumbnails: unknown;
  cloneCount: number;
  projectCount: number;
  updatedAt: string;
  // True when the style is already in the caller's style selector — either a
  // global default or one they've cloned. UI flips "Use" → "Used".
  isInUse: boolean;
};

type CatalogDetail = CatalogStyle & {
  visualStyle: Record<string, unknown> | null;
  styleGuide: string | null;
  layoutPatterns: Array<{ type?: string; description?: string; content_density?: string; frequency?: number }> | null;
};

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType }> = {
  all: { label: "All", icon: Layers },
  it: { label: "IT & Software", icon: Building2 },
  bfsi: { label: "Banking / BFSI", icon: Banknote },
  consulting: { label: "Consulting", icon: Briefcase },
  education: { label: "Education", icon: GraduationCap },
  healthcare: { label: "Healthcare", icon: Heart },
  retail: { label: "Retail", icon: ShoppingBag },
  manufacturing: { label: "Manufacturing", icon: Factory },
  media: { label: "Media", icon: Megaphone },
  nonprofit: { label: "Non-profit", icon: HandHeart },
  other: { label: "Other", icon: Sparkles },
};

export default function CatalogPage() {
  useSession({ required: true });
  const qc = useQueryClient();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{
    items: CatalogStyle[];
    categories: Array<{ value: string; count: number }>;
  }>({
    queryKey: ["style-catalog", q, category],
    queryFn: async () => {
      const url = new URL("/api/styles/catalog", window.location.origin);
      if (q.trim()) url.searchParams.set("q", q.trim());
      if (category !== "all") url.searchParams.set("category", category);
      const r = await fetch(url.toString());
      if (!r.ok) throw new Error("Failed to load catalog");
      return r.json();
    },
  });

  const items = data?.items || [];

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/styles/catalog/${id}/use`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to clone");
      }
      return r.json();
    },
    onSuccess: (data: { name: string; alreadyCloned?: boolean }) => {
      qc.invalidateQueries({ queryKey: ["style-profiles"] });
      qc.invalidateQueries({ queryKey: ["style-catalog"] });
      qc.invalidateQueries({ queryKey: ["style-catalog-detail"] });
      toast.success(
        data.alreadyCloned
          ? `Already in your styles — "${data.name}"`
          : `Added "${data.name}" to your styles`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar />
      <main className="flex-1 ml-[72px]">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Palette className="h-4 w-4 text-primary" />
              <h1 className="text-xl font-semibold tracking-tight">Style Catalog</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Brand styles you can drop into any project — both our built-in templates
              (BITS Pilani, IBM, ICICI, Wipro, HDFC, TCS) and styles shared by the community.
              Click <strong>Use this style</strong> to copy it into your own profiles.
            </p>
          </motion.div>

          {/* Search + filter row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search styles by name or description…"
                className="pl-9 h-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["all", "it", "bfsi", "consulting", "education", "healthcare", "retail", "manufacturing", "media", "nonprofit", "other"] as const).map((c) => {
                const meta = CATEGORY_META[c];
                const Icon = meta.icon;
                const isActive = category === c;
                return (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-full transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="rounded-xl border border-border bg-card px-5 py-16 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-5 py-16 text-center">
              <Palette className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium">No styles match your filters</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Try a different category or clear the search.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {items.map((s) => (
                <CatalogCard
                  key={s.id}
                  style={s}
                  onOpen={() => setOpenId(s.id)}
                  onClone={() => cloneMutation.mutate(s.id)}
                  cloning={cloneMutation.isPending && cloneMutation.variables === s.id}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Detail modal */}
      <CatalogDetailModal
        id={openId}
        onClose={() => setOpenId(null)}
        onClone={(id) => cloneMutation.mutate(id)}
        cloning={cloneMutation.isPending}
      />
    </div>
  );
}

function CatalogCard({
  style,
  onOpen,
  onClone,
  cloning,
}: {
  style: CatalogStyle;
  onOpen: () => void;
  onClone: () => void;
  cloning: boolean;
}) {
  const palette = useMemo(() => extractPalette(style.themeConfig), [style.themeConfig]);
  const meta = CATEGORY_META[style.category || "other"];

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      className="group text-left rounded-lg border border-border bg-card overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all flex flex-col"
    >
      {/* Compact color strip */}
      <div className="h-6 w-full flex shrink-0">
        {palette.length > 0 ? (
          palette.map((c, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: c }} />
          ))
        ) : (
          <div className="flex-1 bg-gradient-to-r from-primary/30 to-primary/10" />
        )}
      </div>

      {/* Body — tight */}
      <div className="px-3 py-2.5 flex-1 flex flex-col">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
            {meta.label}
          </span>
          {style.isGlobal && (
            <span className="text-[8px] uppercase font-semibold tracking-wide text-primary bg-primary/10 px-1 py-0.5 rounded shrink-0">
              Built-in
            </span>
          )}
        </div>
        <h3 className="text-[13px] font-semibold leading-tight truncate">{style.name}</h3>
        {style.description && (
          <p className="text-[10.5px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
            {style.description}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
          <span className="text-[10px] text-muted-foreground/70 inline-flex items-center gap-0.5">
            {style.cloneCount > 0 && (
              <>
                <Users className="h-2.5 w-2.5" />
                {style.cloneCount}
              </>
            )}
          </span>
          {style.isInUse ? (
            <span
              className="text-[10.5px] inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default"
              title="Already in your style profiles"
            >
              <Check className="h-2.5 w-2.5" />
              Used
            </span>
          ) : (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClone();
              }}
              className="text-[10.5px] inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {cloning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Plus className="h-2.5 w-2.5" />}
              Use
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

function CatalogDetailModal({
  id,
  onClose,
  onClone,
  cloning,
}: {
  id: string | null;
  onClose: () => void;
  onClone: (id: string) => void;
  cloning: boolean;
}) {
  const { data, isLoading } = useQuery<CatalogDetail>({
    queryKey: ["style-catalog-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/styles/catalog/${id}`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!id,
  });

  const palette = useMemo(() => extractPalette(data?.themeConfig ?? null), [data]);

  return (
    <AnimatePresence>
      {id && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
          >
            <header className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                Style details
              </p>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto">
              {isLoading || !data ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  {/* Palette strip */}
                  <div className="h-16 rounded-lg overflow-hidden ring-1 ring-border/40 flex">
                    {palette.length > 0 ? (
                      palette.map((c, i) => (
                        <div key={i} className="flex-1 flex items-end p-1.5" style={{ backgroundColor: c }}>
                          <span
                            className="text-[9px] font-mono px-1 py-0.5 rounded"
                            style={{
                              backgroundColor: "rgba(0,0,0,0.4)",
                              color: "white",
                            }}
                          >
                            {c.toUpperCase().replace("#", "")}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 bg-muted/40" />
                    )}
                  </div>

                  {/* Title block */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {data.isGlobal && (
                        <span className="text-[9px] uppercase font-semibold tracking-wide text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          Built-in
                        </span>
                      )}
                      {data.category && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {CATEGORY_META[data.category]?.label || data.category}
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold tracking-tight">{data.name}</h2>
                    {data.description && (
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                        {data.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {data.cloneCount} {data.cloneCount === 1 ? "user" : "users"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        {data.projectCount} {data.projectCount === 1 ? "deck" : "decks"} built
                      </span>
                    </div>
                  </div>

                  {/* Style guide prose */}
                  {data.styleGuide && (
                    <section>
                      <h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                        Style guide
                      </h3>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/85">
                        {data.styleGuide}
                      </p>
                    </section>
                  )}

                  {/* Layout patterns */}
                  {data.layoutPatterns && data.layoutPatterns.length > 0 && (
                    <section>
                      <h3 className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-2">
                        Slide patterns ({data.layoutPatterns.length})
                      </h3>
                      <ul className="space-y-2">
                        {data.layoutPatterns.map((p, i) => (
                          <li
                            key={i}
                            className="rounded-lg border border-border/60 px-3 py-2.5 bg-card"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-medium font-mono">
                                {p.type || `pattern_${i + 1}`}
                              </span>
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                {p.frequency && (
                                  <span>{Math.round((p.frequency || 0) * 100)}%</span>
                                )}
                                {p.content_density && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span className="uppercase tracking-wide">
                                      {p.content_density}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                            {p.description && (
                              <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {p.description}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* Footer CTA */}
            {data && (
              <footer className="border-t border-border/60 px-5 py-3 flex items-center justify-between shrink-0">
                {data.isInUse ? (
                  <>
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      Already in your style profiles
                    </p>
                    <Button size="sm" variant="outline" onClick={onClose} className="gap-1.5">
                      Close
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      Adding it copies the style to your profiles — yours to rename or tweak.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => onClone(data.id)}
                      disabled={cloning}
                      className="gap-1.5"
                    >
                      {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Use this style
                    </Button>
                  </>
                )}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function extractPalette(themeConfig: Record<string, unknown> | null | undefined): string[] {
  if (!themeConfig) return [];
  const colors = (themeConfig.colors as Record<string, string> | undefined) || {};
  const order = [
    "primary",
    "secondary",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
  ];
  return order
    .map((k) => colors[k])
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .slice(0, 6);
}
