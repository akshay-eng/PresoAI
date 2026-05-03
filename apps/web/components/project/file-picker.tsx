"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library, Loader2, Search, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type UploadItem = {
  id: string;
  source: string;
  fileName: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  kind: "image" | "pptx" | "document" | "pdf" | "other";
  createdAt: string;
  previewUrl: string | null;
};

interface FilePickerProps {
  /** Restricts which kinds appear in the picker. Templates: pptx only. References: anything. */
  allowedKinds?: Array<UploadItem["kind"]>;
  buttonLabel?: string;
  onPick: (item: UploadItem) => void | Promise<void>;
  className?: string;
}

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePicker({ allowedKinds, buttonLabel = "Pick from uploads", onPick, className }: FilePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ items: UploadItem[] }>({
    queryKey: ["uploads"],
    queryFn: async () => {
      const r = await fetch("/api/uploads");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    let out = data?.items ?? [];
    if (allowedKinds && allowedKinds.length > 0) {
      out = out.filter((i) => allowedKinds.includes(i.kind));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((i) => i.fileName.toLowerCase().includes(q));
    }
    return out;
  }, [data, allowedKinds, search]);

  async function handlePick(item: UploadItem) {
    setBusyKey(item.s3Key);
    try {
      await onPick(item);
      setPickedKey(item.s3Key);
      setOpen(false);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className={cn("relative", className)} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-9 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors text-xs flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Library className="h-3.5 w-3.5" />
        {buttonLabel}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your uploads…"
              className="flex-1 bg-transparent outline-none text-xs"
            />
            <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-muted">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {data?.items?.length === 0 ? "Nothing uploaded yet." : "No matches."}
              </div>
            ) : (
              <ul className="py-1">
                {filtered.map((item) => {
                  const busy = busyKey === item.s3Key;
                  const picked = pickedKey === item.s3Key;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!!busyKey}
                        onClick={() => handlePick(item)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/40 transition-colors disabled:opacity-50 text-left"
                      >
                        <div className="w-9 h-9 rounded-md bg-muted/40 overflow-hidden shrink-0 flex items-center justify-center">
                          {item.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">
                              {item.fileName.split(".").pop()?.slice(0, 4) || "FILE"}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate">{item.fileName}</p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">
                            {formatBytes(item.fileSize)} · {new Date(item.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
                        {picked && !busy && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
