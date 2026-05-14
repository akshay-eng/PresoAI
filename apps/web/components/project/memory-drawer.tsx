"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, X, Loader2, Trash2, FileText, Sparkles, ListChecks, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Memory = {
  entities: Array<{ label: string; kind?: string; mentions?: number }>;
  decisions: Array<{ what: string; why?: string; at: string }>;
  outlines: Array<{
    jobId: string;
    engine?: string;
    generatedAt: string;
    slides: Array<{ title: string; summary?: string }>;
  }>;
  edits: Array<{ instruction: string; targetSlides?: number[]; at: string }>;
  preferences: Record<string, unknown>;
  narrative: string;
  version: number;
  updatedAt?: string;
  empty: boolean;
};

export function MemoryDrawer({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["project-memory", projectId],
    queryFn: async (): Promise<Memory> => {
      const r = await fetch(`/api/projects/${projectId}/memory`);
      if (!r.ok) throw new Error("Failed to load memory");
      return r.json();
    },
    enabled: open,
    staleTime: 30_000,
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/memory`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to reset memory");
    },
    onSuccess: () => {
      toast.success("Project memory wiped");
      queryClient.invalidateQueries({ queryKey: ["project-memory", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Project memory</h2>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close memory panel"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : !data || data.empty ? (
                <EmptyState />
              ) : (
                <>
                  {data.narrative && (
                    <Section icon={<Sparkles className="h-3.5 w-3.5" />} title="Rolling summary">
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                        {data.narrative}
                      </p>
                    </Section>
                  )}

                  {data.entities.length > 0 && (
                    <Section icon={<FileText className="h-3.5 w-3.5" />} title={`Entities (${data.entities.length})`}>
                      <div className="flex flex-wrap gap-1.5">
                        {data.entities.slice(0, 30).map((e, i) => (
                          <span
                            key={`${e.label}-${i}`}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/60 text-foreground/80"
                            title={e.kind || ""}
                          >
                            {e.label}
                            {e.mentions && e.mentions > 1 && (
                              <span className="text-muted-foreground ml-1">×{e.mentions}</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </Section>
                  )}

                  {data.decisions.length > 0 && (
                    <Section icon={<ListChecks className="h-3.5 w-3.5" />} title={`Decisions (${data.decisions.length})`}>
                      <ul className="space-y-1.5">
                        {data.decisions.slice(-8).reverse().map((d, i) => (
                          <li key={i} className="text-xs">
                            <span className="text-foreground">{d.what}</span>
                            {d.why && <span className="text-muted-foreground"> — {d.why}</span>}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {data.outlines.length > 0 && (
                    <Section icon={<FileText className="h-3.5 w-3.5" />} title={`Prior decks (${data.outlines.length})`}>
                      <ul className="space-y-3">
                        {data.outlines.slice(-3).reverse().map((o, i) => (
                          <li key={o.jobId || i} className="space-y-1">
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(o.generatedAt).toLocaleString()}
                              {o.engine && <span className="ml-1.5 px-1 py-0.5 bg-secondary/40 rounded text-[9px]">{o.engine}</span>}
                            </p>
                            <ul className="space-y-0.5 pl-2 border-l border-border/40">
                              {o.slides.slice(0, 6).map((s, j) => (
                                <li key={j} className="text-xs truncate">{s.title}</li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {data.edits.length > 0 && (
                    <Section icon={<Pencil className="h-3.5 w-3.5" />} title={`Edits (${data.edits.length})`}>
                      <ul className="space-y-1">
                        {data.edits.slice(-5).reverse().map((e, i) => (
                          <li key={i} className="text-xs">
                            <span className="text-foreground">{e.instruction}</span>
                            {e.targetSlides && e.targetSlides.length > 0 && (
                              <span className="text-muted-foreground"> (slide{e.targetSlides.length > 1 ? "s" : ""} {e.targetSlides.join(", ")})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {Object.keys(data.preferences).length > 0 && (
                    <Section title="Preferences">
                      <ul className="text-xs space-y-0.5">
                        {Object.entries(data.preferences).map(([k, v]) => (
                          <li key={k}>
                            <span className="text-muted-foreground">{k}:</span> {String(v)}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </>
              )}
            </div>

            <footer className="border-t border-border/60 px-5 py-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {data && !data.empty
                  ? `version ${data.version} · updated ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}`
                  : "no memory yet"}
              </span>
              {data && !data.empty && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
                  disabled={resetMutation.isPending}
                  onClick={() => {
                    if (confirm("Wipe all memory for this project? The agent will start fresh on the next generation.")) {
                      resetMutation.mutate();
                    }
                  }}
                >
                  {resetMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Reset
                </Button>
              )}
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Brain className="h-8 w-8 text-muted-foreground/30 mb-2" />
      <p className="text-sm font-medium">No memory yet</p>
      <p className="text-[11px] text-muted-foreground mt-1 max-w-[260px]">
        After your first generation or edit, the agent will start remembering
        what was discussed, decided, and built. That context is then fed into
        every future turn.
      </p>
    </div>
  );
}
