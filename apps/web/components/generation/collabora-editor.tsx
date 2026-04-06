"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

// Cache the editor URL so subsequent opens are instant
const editorUrlCache = new Map<string, string>();

interface CollaboraEditorProps {
  presentationId: string;
}

export function CollaboraEditor({ presentationId }: CollaboraEditorProps) {
  const [iframeUrl, setIframeUrl] = useState<string | null>(editorUrlCache.get(presentationId) || null);
  const [loading, setLoading] = useState(!editorUrlCache.has(presentationId));
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // If cached, use immediately
    if (editorUrlCache.has(presentationId)) {
      setIframeUrl(editorUrlCache.get(presentationId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadEditor() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/presentations/${presentationId}/editor`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Editor unavailable");
        }

        const { iframeUrl: url } = await res.json();
        if (cancelled) return;

        // Cache for instant reload
        editorUrlCache.set(presentationId, url);
        setIframeUrl(url);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
          toast.error((err as Error).message);
        }
      }
    }

    loadEditor();
    return () => { cancelled = true; };
  }, [presentationId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground">Loading editor...</p>
      </div>
    );
  }

  if (error || !iframeUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-5">
        <p className="text-xs text-muted-foreground text-center">
          {error || "Editor unavailable. Make sure Collabora is running."}
        </p>
        <p className="text-[10px] text-muted-foreground/50">docker compose up -d collabora collabora-proxy</p>
      </div>
    );
  }

  return (
    <div className="h-full">
      <iframe
        ref={iframeRef}
        src={iframeUrl}
        className="w-full h-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
