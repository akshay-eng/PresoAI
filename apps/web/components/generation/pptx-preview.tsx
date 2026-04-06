"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Download, ExternalLink, Loader2, Pencil, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PptxPreviewProps {
  presentationId: string;
  projectId: string;
  onOpenEditor?: () => void;
}

export function PptxPreview({ presentationId, projectId, onOpenEditor }: PptxPreviewProps) {
  const [pptxData, setPptxData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [PPTXViewerComp, setPPTXViewerComp] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewerWidth, setViewerWidth] = useState(800);
  const [editorMode, setEditorMode] = useState(false);
  const [editorIframeUrl, setEditorIframeUrl] = useState<string | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);

  const measure = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.getBoundingClientRect().width - 32;
    setViewerWidth(Math.max(500, Math.floor(w)));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/presentations/${presentationId}/download`);
        if (!res.ok) throw new Error("Failed to get download URL");
        const { downloadUrl } = await res.json();

        const pptxRes = await fetch(downloadUrl);
        if (!pptxRes.ok) throw new Error("Failed to download PPTX");
        const arrayBuffer = await pptxRes.arrayBuffer();

        const { parsePPTX, PPTXViewer } = await import("@kandiforge/pptx-renderer");
        if (cancelled) return;

        const data = await parsePPTX(arrayBuffer);
        if (cancelled) return;

        setPptxData(data);
        setPPTXViewerComp(() => PPTXViewer as unknown as React.ComponentType<Record<string, unknown>>);
        setLoading(false);
        setTimeout(measure, 100);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => { cancelled = true; };
  }, [presentationId, measure]);

  async function handleDownload() {
    try {
      const res = await fetch(`/api/presentations/${presentationId}/download`);
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

  async function handleOpenEditor() {
    try {
      setEditorLoading(true);

      const res = await fetch(`/api/presentations/${presentationId}/editor`);
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Editor unavailable");
        setEditorLoading(false);
        return;
      }

      const { iframeUrl } = await res.json();
      setEditorIframeUrl(iframeUrl);
      setEditorMode(true);
      setEditorLoading(false);
    } catch (err) {
      toast.error((err as Error).message);
      setEditorLoading(false);
    }
  }

  function handleCloseEditor() {
    setEditorMode(false);
    setEditorIframeUrl(null);
    // Reload preview to pick up any edits
    setLoading(true);
    setPptxData(null);
    setPPTXViewerComp(null);
    // Re-trigger the preview load
    const loadTimer = setTimeout(() => {
      setLoading(false); // Will re-trigger the useEffect
    }, 100);
    return () => clearTimeout(loadTimer);
  }

  async function handleEditInCanva() {
    window.open("https://www.canva.com/create/presentations/", "_blank");
    await handleDownload();
    toast.success("Canva opened! Upload the downloaded file to import it.");
  }

  const viewerHeight = Math.floor(viewerWidth * 9 / 16);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Loading preview...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-xs text-muted-foreground">Preview unavailable</p>
        <Button size="sm" onClick={handleDownload}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download PPTX
        </Button>
      </div>
    );
  }

  // Editor mode — Collabora iframe
  if (editorMode && editorIframeUrl) {
    return (
      <div ref={containerRef} className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleCloseEditor}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
            Back to preview
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <iframe
            src={editorIframeUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    );
  }

  // Preview mode
  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex-1 overflow-auto flex items-start justify-center px-4 pt-4">
        {PPTXViewerComp && pptxData ? (
          <PPTXViewerComp
            pptxData={pptxData}
            showFilmstrip={true}
            filmstripPosition="bottom"
            showSpeakerNotes={false}
            showModeToggle={false}
            width={viewerWidth}
            height={viewerHeight}
          />
        ) : (
          <div className="flex items-center justify-center h-40">
            <p className="text-xs text-muted-foreground">No preview</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 shrink-0 border-t border-border/40">
        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1" onClick={handleDownload}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onOpenEditor ? onOpenEditor() : handleOpenEditor()}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={handleEditInCanva}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Canva
          </Button>
        </div>
      </div>
    </div>
  );
}
