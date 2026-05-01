"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Sparkles, FileText, Plus, Upload, Cloud, BookOpen, HardDrive,
  ChevronRight, Loader2, X, CheckCircle2, AlertCircle, Layers, ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const ease = [0.22, 1, 0.36, 1] as const;

type SourceFile = {
  id: string;
  fileName: string;
  s3Key: string;
  fileSize: number;
  slideCount: number | null;
  status: "pending" | "indexing" | "ready" | "failed";
  error: string | null;
  createdAt: string;
  indexedAt: string | null;
};

type SearchResult = {
  id: string;
  rank: number;
  score: number;
  slideNumber: number;
  snippet: string;
  thumbnailUrl: string | null;
  sourceFileId: string;
  sourceFileName: string;
  dominantColors: Array<{ hex: string; weight: number }> | null;
};

async function uploadToS3(file: File): Promise<{ s3Key: string }> {
  const presign = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      purpose: "find-source",
    }),
  });
  if (!presign.ok) throw new Error("Presign failed");
  const { signedUrl, key } = (await presign.json()) as { signedUrl: string; key: string };
  const put = await fetch(signedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  return { s3Key: key };
}

export default function FindPage() {
  useSession({ required: true });
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [showSourcesMenu, setShowSourcesMenu] = useState(false);
  const [showSourcesPanel, setShowSourcesPanel] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sources list — polled while anything is indexing.
  const sourcesQuery = useQuery<{ items: SourceFile[] }>({
    queryKey: ["find-sources"],
    queryFn: async () => {
      const res = await fetch("/api/find/sources");
      if (!res.ok) throw new Error("Failed to load sources");
      return res.json();
    },
    refetchInterval: (q) => {
      const items = (q.state.data?.items || []) as SourceFile[];
      const anyActive = items.some((s) => s.status === "pending" || s.status === "indexing");
      return anyActive ? 2500 : false;
    },
  });
  const sources = sourcesQuery.data?.items || [];
  const indexingCount = sources.filter((s) => s.status === "pending" || s.status === "indexing").length;
  const readyCount = sources.filter((s) => s.status === "ready").length;

  // Search results — fetched only when user submits.
  const resultsQuery = useQuery<{ results: SearchResult[] }>({
    queryKey: ["find-search", submittedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/find/search?q=${encodeURIComponent(submittedQuery)}&limit=24`);
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: submittedQuery.length > 0,
  });
  const results = resultsQuery.data?.results || [];

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded: Array<{ fileName: string; s3Key: string; fileSize: number }> = [];
      for (const f of files) {
        const { s3Key } = await uploadToS3(f);
        uploaded.push({ fileName: f.name, s3Key, fileSize: f.size });
      }
      const res = await fetch("/api/find/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploaded }),
      });
      if (!res.ok) throw new Error("Failed to register source files");
      return res.json();
    },
    onMutate: () => setUploading(true),
    onSettled: () => setUploading(false),
    onSuccess: (data: { items: SourceFile[] }) => {
      toast.success(`Indexing ${data.items.length} file${data.items.length === 1 ? "" : "s"}...`);
      queryClient.invalidateQueries({ queryKey: ["find-sources"] });
      setShowSourcesPanel(true);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/find/sources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["find-sources"] });
      queryClient.invalidateQueries({ queryKey: ["find-search"] });
      toast.success("Removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleFiles = useCallback((fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => /\.pptx?$/i.test(f.name));
    if (files.length === 0) {
      toast.error("Only .pptx files are supported");
      return;
    }
    uploadMutation.mutate(files);
    setShowSourcesMenu(false);
  }, [uploadMutation]);

  // Outside-click for sources popover
  useEffect(() => {
    if (!showSourcesMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-sources-popover]")) setShowSourcesMenu(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showSourcesMenu]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmittedQuery(query.trim());
  }

  function runQuickQuery(q: string) {
    setQuery(q);
    setSubmittedQuery(q);
  }

  const searching = resultsQuery.isFetching && submittedQuery.length > 0;
  const hasResults = submittedQuery.length > 0;

  return (
    <div
      className="min-h-screen flex relative"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
      }}
    >
      <AppSidebar />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Drag overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none"
          >
            <div className="rounded-2xl border-2 border-dashed border-primary bg-background/80 px-8 py-6 text-center">
              <Upload className="h-8 w-8 text-primary mx-auto mb-2" />
              <p className="text-sm font-semibold">Drop PPTX files to index</p>
              <p className="text-xs text-muted-foreground mt-1">They&apos;ll be searchable in a few minutes.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 ml-[72px]">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="max-w-3xl mx-auto pt-20 pb-8 px-6"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Search className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                Find
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSourcesPanel(!showSourcesPanel)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>{readyCount} indexed</span>
              {indexingCount > 0 && (
                <span className="flex items-center gap-1 text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {indexingCount} indexing
                </span>
              )}
              <ChevronRight className={`h-3 w-3 transition-transform ${showSourcesPanel ? "rotate-90" : ""}`} />
            </button>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Find your slide</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-xl">
            Search across all your decks by topic, content, or what they look like —
            try &ldquo;ITSM&rdquo;, &ldquo;architecture diagram&rdquo;, or &ldquo;red blocks&rdquo;.
          </p>

          {/* Search form */}
          <form onSubmit={handleSearch}>
            <div className="rounded-xl border border-border/60 bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:border-border">
              <div className="flex items-center gap-2 px-2 py-2">
                <div className="relative" data-sources-popover>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSourcesMenu(!showSourcesMenu);
                    }}
                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                      showSourcesMenu
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                    title="Add a source"
                  >
                    <Plus className="h-4 w-4" />
                  </button>

                  <AnimatePresence>
                    {showSourcesMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 mt-2 w-72 rounded-xl border border-border bg-popover shadow-xl z-30 overflow-hidden"
                        data-sources-popover
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-2 border-b border-border/50">
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Search sources
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                            Add a source to expand your search
                          </p>
                        </div>
                        <div className="py-1">
                          <SourceItem
                            icon={Upload}
                            label={uploading ? "Uploading..." : "Upload PPTX"}
                            description="One or many .pptx files"
                            iconBg="bg-blue-500/10 text-blue-500"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                          />
                          <SourceItem icon={Cloud} label="Connect SharePoint" description="Coming soon" iconBg="bg-violet-500/10 text-violet-500" disabled />
                          <SourceItem icon={BookOpen} label="Connect Confluence" description="Coming soon" iconBg="bg-sky-500/10 text-sky-500" disabled />
                          <SourceItem icon={HardDrive} label="Connect Google Drive" description="Coming soon" iconBg="bg-emerald-500/10 text-emerald-500" disabled />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Search className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                <Input
                  type="text"
                  placeholder='Try "architecture of incident management" or "red blocks"...'
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
                  {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Search"}
                </Button>
              </div>
            </div>
          </form>

          {/* Sources panel */}
          <AnimatePresence>
            {showSourcesPanel && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 rounded-lg border border-border/60 bg-card/40">
                  <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Indexed files ({sources.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[10px] text-primary hover:underline"
                      disabled={uploading}
                    >
                      {uploading ? "Uploading..." : "+ Upload more"}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {sourcesQuery.isLoading ? (
                      <div className="p-3 space-y-2">
                        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                      </div>
                    ) : sources.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No files yet. Drop PPTX files anywhere on this page or click <strong>+ Upload more</strong>.
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/40">
                        {sources.map((s) => (
                          <li key={s.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium">{s.fileName}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {(s.fileSize / 1024).toFixed(0)} KB
                                {s.slideCount ? ` · ${s.slideCount} slides` : ""}
                              </p>
                            </div>
                            <SourceStatus s={s} />
                            <button
                              type="button"
                              onClick={() => deleteSourceMutation.mutate(s.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                              title="Remove"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
                className="text-center py-12"
              >
                <div className="inline-flex flex-col items-center gap-3">
                  <div className="h-14 w-14 rounded-2xl bg-muted/40 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Search across your indexed slides</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      We search by text, meaning, and visual content. Try natural language.
                    </p>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
                  {["ITSM", "architecture of incident management", "red blocks", "roadmap"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => runQuickQuery(s)}
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
                <div className="flex items-center justify-between">
                  <p className="text-sm">
                    {searching ? (
                      <span className="text-muted-foreground">
                        Searching for &ldquo;{submittedQuery}&rdquo;...
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">{results.length} result{results.length === 1 ? "" : "s"}</span>{" "}
                        <span className="text-muted-foreground">for &ldquo;{submittedQuery}&rdquo;</span>
                      </>
                    )}
                  </p>
                </div>

                {searching && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
                        <Skeleton className="aspect-[16/10] w-full rounded-md" />
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2 w-1/2" />
                      </div>
                    ))}
                  </div>
                )}

                {!searching && results.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border/60 bg-card/50 p-12 text-center">
                    <FileText className="h-5 w-5 text-muted-foreground/50 mx-auto mb-2" />
                    <p className="text-sm font-medium">No matching slides</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                      {sources.length === 0
                        ? "Upload some PPTX files first to make them searchable."
                        : "Try different words or wait for indexing to finish."}
                    </p>
                  </div>
                )}

                {!searching && results.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {results.map((r) => <ResultCard key={r.id} result={r} />)}
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

function SourceStatus({ s }: { s: SourceFile }) {
  if (s.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        ready
      </span>
    );
  }
  if (s.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-destructive" title={s.error || "Failed"}>
        <AlertCircle className="h-3 w-3" />
        failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-primary">
      <Loader2 className="h-3 w-3 animate-spin" />
      {s.status === "pending" ? "queued" : "indexing"}
    </span>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  // Pull the strongest non-neutral dominant color for accent stripe + ghost-sheet tint.
  const accent = pickAccentColor(result.dominantColors);
  const cleanName = result.sourceFileName.replace(/\.pptx?$/i, "");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="group relative cursor-pointer pt-2 pl-2"
    >
      {/* Ghost sheet — back-most paper of the stack */}
      <div
        className="absolute top-0 left-0 right-3 bottom-3 rounded-xl bg-card border border-border/40 -rotate-1.5 transition-all duration-300 group-hover:-rotate-3 group-hover:-translate-x-1.5 group-hover:-translate-y-1"
        style={{ boxShadow: `inset 0 0 0 9999px ${accent}08` }}
      />
      {/* Ghost sheet — middle */}
      <div className="absolute top-1 left-1 right-2 bottom-2 rounded-xl bg-card border border-border/50 -rotate-0.5 transition-all duration-300 group-hover:-rotate-1 group-hover:-translate-x-1" />

      {/* Main card */}
      <div className="relative rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-0.5">
        {/* Accent stripe from slide's dominant color */}
        <div
          className="h-[3px] w-full transition-all duration-300 group-hover:h-1"
          style={{ background: `linear-gradient(90deg, ${accent}, ${accent}cc 55%, ${accent}66 100%)` }}
        />

        {/* Slide thumbnail */}
        <div className="relative aspect-[16/10] bg-muted/30 p-3 flex items-center justify-center">
          {result.thumbnailUrl ? (
            <div className="relative w-full h-full rounded-sm bg-white shadow-md ring-1 ring-black/5 overflow-hidden">
              <img
                src={result.thumbnailUrl}
                alt={`${cleanName} slide ${result.slideNumber}`}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          ) : (
            <FileText className="h-7 w-7 text-muted-foreground/40" />
          )}

          {/* Slide number — typewriter-style label, top-right */}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-foreground/95 text-background px-2 py-0.5 text-[9.5px] font-bold tracking-[0.12em] uppercase shadow-md backdrop-blur-sm">
            <span className="opacity-55">slide</span>
            <span className="tabular-nums">{String(result.slideNumber).padStart(2, "0")}</span>
          </div>

          {/* Hover-only "open" indicator */}
          <div className="absolute bottom-1.5 right-1.5 h-6 w-6 rounded-full bg-background/95 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-300 shadow-md">
            <ArrowUpRight className="h-3 w-3" />
          </div>
        </div>

        {/* Citation footer */}
        <div className="px-3 py-2.5 border-t border-border/40 bg-card">
          <div className="flex items-start gap-2">
            <span
              className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded shrink-0"
              style={{ backgroundColor: `${accent}1f`, color: accent }}
            >
              <Layers className="h-2.5 w-2.5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold line-clamp-1" title={result.sourceFileName}>
                {cleanName}
              </p>
              {result.snippet && (
                <p className="text-[10.5px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug italic">
                  &ldquo;{result.snippet}&rdquo;
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function pickAccentColor(palette: SearchResult["dominantColors"]): string {
  const fallback = "#6366f1";
  if (!palette || palette.length === 0) return fallback;
  // Prefer chromatic colors over greys/whites/blacks.
  for (const c of palette) {
    const rgb = parseHex(c.hex);
    if (!rgb) continue;
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const saturation = max === min ? 0 : (max - min) / (lightness < 128 ? max + min : 510 - max - min);
    if (saturation > 0.18 && lightness > 32 && lightness < 230) {
      return c.hex;
    }
  }
  return palette[0]?.hex || fallback;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function SourceItem({
  icon: Icon, label, description, iconBg, disabled, onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  iconBg: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-2 transition-colors group text-left ${
        disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50"
      }`}
    >
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight">{label}</p>
        <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 truncate">
          {description}
        </p>
      </div>
      {!disabled && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />}
    </button>
  );
}
