"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, RefreshCw, Check, X, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useGenerationStore } from "@/lib/stores/generation-store";
import { api } from "@/lib/api-client";

const PHASE_LABELS: Record<string, string> = {
  starting: "Starting...",
  extract_template: "Extracting theme",
  process_references: "Processing references",
  researching: "Researching",
  synthesizing: "Synthesizing research",
  planning: "Planning outline",
  awaiting_review: "Awaiting your review",
  outline_approved: "Outline approved",
  writing_slides: "Writing slides",
  awaiting_content_review: "Awaiting content review",
  building_pptx: "Building PPTX",
  injecting_theme: "Injecting theme",
  generating_thumbnails: "Generating thumbnails",
  finalizing: "Saving...",
  reflecting: "Reviewing quality",
  reflection_done: "Quality check passed",
  reflection_revised: "Slides revised",
  reflection_skipped: "Quality check skipped",
  agent_complete: "Building PPTX",
  complete: "Done!",
  failed: "Failed",
};

interface GenerationPanelProps {
  projectId: string;
}

export function GenerationPanel({ projectId }: GenerationPanelProps) {
  const {
    jobId,
    phase,
    progress,
    message,
    outline,
    slides,
    isGenerating,
    error,
    updateProgress,
  } = useGenerationStore();

  const eventSourceRef = useRef<EventSource | null>(null);
  const [editingOutline, setEditingOutline] = useState(false);
  const [editedOutline, setEditedOutline] = useState<typeof outline>([]);

  const connectSSE = useCallback(
    (jId: string) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource(`/api/jobs/${jId}/progress`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          updateProgress(data.phase, data.progress, data.message, data.data);
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
      };
    },
    [updateProgress]
  );

  useEffect(() => {
    if (jobId && isGenerating) {
      connectSSE(jobId);
    }
    return () => {
      eventSourceRef.current?.close();
    };
  }, [jobId, isGenerating, connectSSE]);

  useEffect(() => {
    if (outline.length > 0) {
      setEditedOutline(outline.map((o) => ({ ...o })));
    }
  }, [outline]);

  async function handleApprove() {
    if (!jobId) return;
    try {
      const outlineToSend = editingOutline ? editedOutline : undefined;
      await api.approveJob(jobId, {
        approved: true,
        editedOutline: outlineToSend,
      });
      setEditingOutline(false);
      toast.success("Outline approved! Generating slides...");
    } catch (err) {
      toast.error(`Approval failed: ${(err as Error).message}`);
    }
  }

  async function handleReject() {
    if (!jobId) return;
    try {
      await api.approveJob(jobId, {
        approved: false,
        feedback: "User rejected the outline",
      });
      toast.info("Outline rejected");
    } catch (err) {
      toast.error(`Rejection failed: ${(err as Error).message}`);
    }
  }

  if (!jobId) return null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{PHASE_LABELS[phase] || phase}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
        <Progress value={progress * 100} />
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{error}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Retrying will resume from where it stopped.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full text-xs"
            onClick={() => {
              useGenerationStore.getState().reset();
              toast.info("Click Generate to retry.");
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Dismiss
          </Button>
        </div>
      )}

      {phase === "awaiting_review" && outline.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Review Outline</p>
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditingOutline(!editingOutline)}>
              <Edit2 className="mr-1 h-3 w-3" />
              {editingOutline ? "Cancel" : "Edit"}
            </Button>
          </div>

          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {(editingOutline ? editedOutline : outline).map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-secondary/30 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  {editingOutline ? (
                    <input
                      className="flex-1 bg-transparent border-b border-primary/30 text-xs font-medium focus:outline-none focus:border-primary/60 pb-0.5"
                      value={editedOutline[i]?.title || ""}
                      onChange={(e) => {
                        const updated = [...editedOutline];
                        if (updated[i]) {
                          updated[i] = { ...updated[i], title: e.target.value };
                          setEditedOutline(updated);
                        }
                      }}
                    />
                  ) : (
                    <span className="text-xs font-medium">{i + 1}. {item.title}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] shrink-0">{item.layout}</Badge>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {item.key_points.map((point, j) => (
                    <li key={j} className="text-xs text-muted-foreground pl-2">- {point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button onClick={handleApprove} size="sm" className="flex-1 text-xs">
              <Check className="mr-1 h-3 w-3" />
              {editingOutline ? "Approve Edits" : "Approve"}
            </Button>
            <Button onClick={handleReject} variant="destructive" size="sm" className="flex-1 text-xs">
              <X className="mr-1 h-3 w-3" />
              Reject
            </Button>
          </div>
        </div>
      )}

      {phase === "complete" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-600/30 bg-green-600/5 p-4 text-center">
            <Check className="mx-auto h-6 w-6 text-green-500" />
            <p className="mt-2 text-sm font-semibold text-green-400">Presentation Ready</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              className="w-full"
              onClick={async () => {
                try {
                  const jobData = await api.getJob(jobId!) as { output?: { presentationId?: string } };
                  const presId = jobData?.output?.presentationId;
                  if (!presId) { toast.error("Presentation not found yet"); return; }
                  const res = await fetch(`/api/presentations/${presId}/download`);
                  if (!res.ok) throw new Error("Download failed");
                  const { downloadUrl, fileName } = await res.json();
                  const a = document.createElement("a");
                  a.href = downloadUrl;
                  a.download = fileName || "presentation.pptx";
                  a.click();
                } catch (err) { toast.error((err as Error).message); }
              }}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download PPTX
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => toast.info("Connect Microsoft account to use this feature")}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open in PowerPoint
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => toast.info("Connect Canva account to use this feature")}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Edit in Canva
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
