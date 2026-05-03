"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Upload,
  Trash2,
  FileText,
  FileImage,
  Presentation,
  FileType,
  File as FileIcon,
  Loader2,
  Search,
  Download,
  ExternalLink,
} from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";

type UploadItem = {
  id: string;
  source: "user-upload" | "template" | "reference" | "source-file" | "style-source" | "chat-image";
  fileName: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  kind: "image" | "pptx" | "document" | "pdf" | "other";
  createdAt: string;
  previewUrl: string | null;
  linkedTo: { type: string; id: string; name: string } | null;
  canDelete: boolean;
};

type ListResponse = { items: UploadItem[] };

const KIND_FILTERS: Array<{ id: UploadItem["kind"]; label: string }> = [
  { id: "image", label: "Images" },
  { id: "pptx", label: "Presentations" },
  { id: "document", label: "Documents" },
  { id: "pdf", label: "PDFs" },
  { id: "other", label: "Other" },
];

const SOURCE_LABEL: Record<UploadItem["source"], string> = {
  "user-upload": "Direct upload",
  template: "Brand template",
  reference: "Reference",
  "source-file": "Find source",
  "style-source": "Style profile",
  "chat-image": "Pasted in chat",
};

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffH = (now - d.getTime()) / 3600000;
  if (diffH < 1) return `${Math.max(1, Math.floor(diffH * 60))}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.floor(diffH / 24)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function KindIcon({ kind, className }: { kind: UploadItem["kind"]; className?: string }) {
  if (kind === "image") return <FileImage className={className} />;
  if (kind === "pptx") return <Presentation className={className} />;
  if (kind === "document") return <FileText className={className} />;
  if (kind === "pdf") return <FileType className={className} />;
  return <FileIcon className={className} />;
}

function kindAccent(kind: UploadItem["kind"]): string {
  switch (kind) {
    case "image": return "from-emerald-500/15 to-emerald-500/5 text-emerald-500";
    case "pptx": return "from-primary/15 to-primary/5 text-primary";
    case "document": return "from-sky-500/15 to-sky-500/5 text-sky-500";
    case "pdf": return "from-red-500/15 to-red-500/5 text-red-500";
    default: return "from-zinc-500/15 to-zinc-500/5 text-zinc-400";
  }
}

export default function UploadsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<UploadItem["kind"]>("pptx");
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["uploads"],
    queryFn: async () => {
      const r = await fetch("/api/uploads");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    let out = items.filter((i) => i.kind === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((i) => i.fileName.toLowerCase().includes(q));
    }
    return out;
  }, [items, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.kind] = (c[i.kind] || 0) + 1;
    return c;
  }, [items]);

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      const r = await fetch(`/api/uploads?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Delete failed");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads"] });
      toast.success("Deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      try {
        setUploading({ name: file.name, progress: 0 });
        const presignRes = await fetch("/api/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            purpose: "general",
          }),
        });
        if (!presignRes.ok) throw new Error("Presign failed");
        const { signedUrl, key } = await presignRes.json();

        await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });

        await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            s3Key: key,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
            purpose: "general",
          }),
        });

        setUploading({ name: file.name, progress: 100 });
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        toast.error(`${file.name}: ${(err as Error).message}`);
      }
    }
    setUploading(null);
    queryClient.invalidateQueries({ queryKey: ["uploads"] });
  }

  async function downloadItem(item: UploadItem) {
    try {
      if (item.previewUrl) {
        window.open(item.previewUrl, "_blank");
        return;
      }
      const r = await fetch(`/api/uploads/url?key=${encodeURIComponent(item.s3Key)}`);
      if (!r.ok) throw new Error("Failed to get download URL");
      const { url } = await r.json();
      window.open(url, "_blank");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen flex relative">
      <AppSidebar />

      <div
        className="flex-1 ml-[72px] relative"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        }}
      >
        {/* Drag overlay — only visible while a file is being dragged */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-30 m-4 rounded-2xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <Upload className="h-10 w-10 mx-auto mb-2 text-primary" />
              <p className="text-sm font-medium">Drop to upload</p>
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-8 py-8">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }}
          />

          {/* Header */}
          <div className="flex items-end justify-between mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Uploads</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Every file you&apos;ve uploaded — templates, references, and pasted images. Drop files anywhere on this page.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-muted-foreground tabular-nums">
                {items.length} {items.length === 1 ? "file" : "files"}
              </span>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={!!uploading}
                className="h-9 rounded-lg bg-primary text-primary-foreground px-3.5 flex items-center gap-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? `Uploading ${uploading.name.length > 18 ? uploading.name.slice(0, 18) + "…" : uploading.name}` : "Upload"}
              </button>
            </div>
          </div>

          {/* Filters + search */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${
                    filter === f.id
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background hover:bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {f.label}
                  {counts[f.id] !== undefined && counts[f.id] > 0 && (
                    <span className="ml-1.5 opacity-60 tabular-nums">{counts[f.id]}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="ml-auto relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search filenames…"
                className="h-8 w-64 rounded-lg border border-border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
              {items.length === 0 ? "No uploads yet — drop a file above to get started." : "No files match this filter."}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              <AnimatePresence>
                {filtered.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.18 }}
                    className="group relative rounded-xl border border-border bg-card overflow-hidden hover:border-border/80 hover:shadow-sm transition-all"
                  >
                    {/* Preview / icon */}
                    <div className={`aspect-[4/3] relative bg-gradient-to-br ${kindAccent(item.kind)} flex items-center justify-center`}>
                      {item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.previewUrl}
                          alt={item.fileName}
                          className={`absolute inset-0 w-full h-full ${item.kind === "image" ? "object-cover" : "object-contain bg-background"}`}
                          loading="lazy"
                        />
                      ) : (
                        <KindIcon kind={item.kind} className="h-10 w-10 opacity-80" />
                      )}

                      {/* Source badge */}
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-background/90 backdrop-blur text-[9px] font-medium text-muted-foreground border border-border/40">
                        {SOURCE_LABEL[item.source]}
                      </div>

                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadItem(item); }}
                          className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border/40 flex items-center justify-center hover:bg-background"
                          title="Open"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {item.canDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete "${item.fileName}"? This permanently removes it from storage.`)) {
                                deleteMutation.mutate(item.s3Key);
                              }
                            }}
                            className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border/40 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="p-2.5">
                      <p className="text-xs font-medium truncate" title={item.fileName}>
                        {item.fileName}
                      </p>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground tabular-nums">
                        <span>{formatBytes(item.fileSize)}</span>
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      {item.linkedTo && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/80 truncate">
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate" title={item.linkedTo.name}>{item.linkedTo.name}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
