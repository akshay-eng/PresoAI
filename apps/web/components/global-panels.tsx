"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, ExternalLink, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Presentation {
  id: string;
  title: string;
  s3Key: string;
  slideCount: number;
  version: number;
  createdAt: string;
  project: { id: string; name: string; prompt: string };
}

interface GlobalPanelsProps {
  activePanel: string;
  onClose: () => void;
}

export function GlobalPanels({ activePanel, onClose }: GlobalPanelsProps) {
  const show = activePanel === "files" || activePanel === "editor";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ x: -300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -300, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed left-[72px] top-0 bottom-0 z-40 w-[380px] border-r border-border/60 bg-card shadow-lg overflow-hidden"
        >
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
              <p className="text-sm font-semibold">
                {activePanel === "files" && "All Files"}
                {activePanel === "editor" && "Editor"}
              </p>
              <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {activePanel === "files" && <AllFilesPanel />}
              {activePanel === "editor" && <EditorLauncherPanel />}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AllFilesPanel() {
  const router = useRouter();
  const [files, setFiles] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/files");
        if (res.ok) {
          setFiles(await res.json());
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  async function handleDownload(presId: string) {
    try {
      const res = await fetch(`/api/presentations/${presId}/download`);
      if (!res.ok) throw new Error("Download failed");
      const { downloadUrl, fileName } = await res.json();
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName || "presentation.pptx";
      a.click();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12 px-5">
        <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No files yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Generated presentations will appear here</p>
      </div>
    );
  }

  // Group by project
  const byProject = new Map<string, { project: Presentation["project"]; files: Presentation[] }>();
  for (const f of files) {
    const key = f.project.id;
    if (!byProject.has(key)) {
      byProject.set(key, { project: f.project, files: [] });
    }
    byProject.get(key)!.files.push(f);
  }

  return (
    <div className="p-4 space-y-4">
      {Array.from(byProject.entries()).map(([projId, { project, files: projFiles }]) => (
        <div key={projId}>
          <button
            onClick={() => router.push(`/projects/${projId}`)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2 flex items-center gap-1.5"
          >
            <FileText className="h-3 w-3" />
            {project.name || project.prompt?.substring(0, 40) || "Untitled"}
          </button>

          <div className="space-y-1.5 pl-1">
            {projFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2.5 group hover:border-primary/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{f.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">v{f.version}</Badge>
                    <span className="text-[10px] text-muted-foreground">{f.slideCount} slide{f.slideCount !== 1 ? "s" : ""}</span>
                    <span className="text-[10px] text-muted-foreground/50">{new Date(f.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDownload(f.id)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EditorLauncherPanel() {
  const router = useRouter();
  const [files, setFiles] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/files");
        if (res.ok) setFiles(await res.json());
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12 px-5">
        <p className="text-sm text-muted-foreground">No presentations to edit</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Generate a presentation first</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <p className="text-xs text-muted-foreground mb-3">Select a presentation to open in the Collabora editor.</p>
      {files.map((f) => (
        <button
          key={f.id}
          onClick={() => router.push(`/projects/${f.project.id}`)}
          className="w-full flex items-center gap-3 rounded-lg border border-border bg-background p-3 hover:border-primary/20 hover:bg-muted/30 transition-colors text-left"
        >
          <div className="w-10 h-7 rounded bg-muted flex items-center justify-center shrink-0">
            <FileText className="h-3.5 w-3.5 text-muted-foreground/50" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{f.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{f.project.name}</p>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
        </button>
      ))}
    </div>
  );
}
