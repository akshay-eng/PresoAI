"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, ExternalLink, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DownloadMenuProps {
  presentationId: string;
  /** Visual variant passed down to the trigger Button */
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
  /** Label shown on the trigger. Defaults to "Download" */
  label?: string;
}

async function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
}

export function DownloadMenu({
  presentationId,
  variant = "outline",
  size = "sm",
  className,
  label = "Download",
}: DownloadMenuProps) {
  const [loading, setLoading] = useState<"pptx" | "pdf" | null>(null);

  async function downloadPptx() {
    setLoading("pptx");
    try {
      const res = await fetch(`/api/presentations/${presentationId}/download`);
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(error);
      }
      const { downloadUrl, fileName } = await res.json();
      await triggerDownload(downloadUrl, fileName || "presentation.pptx");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function downloadPdf() {
    setLoading("pdf");
    try {
      const res = await fetch(`/api/presentations/${presentationId}/download?format=pdf`);
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "PDF not available" }));
        throw new Error(error);
      }
      const { downloadUrl, fileName } = await res.json();
      await triggerDownload(downloadUrl, fileName || "presentation.pdf");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  function openInCanva() {
    // Redirect to Canva OAuth — user logs into their own Canva account,
    // we upload the PPTX with the resulting token, then redirect to the editor.
    window.location.href = `/api/integrations/canva/oauth/authorize?presentationId=${encodeURIComponent(presentationId)}`;
  }

  async function exportToGoogleSlides() {
    try {
      // Download the PPTX, then guide the user to import it into Google Slides
      const res = await fetch(`/api/presentations/${presentationId}/download`);
      if (!res.ok) throw new Error("Download failed");
      const { downloadUrl, fileName } = await res.json();

      // Trigger the PPTX download
      await triggerDownload(downloadUrl, fileName || "presentation.pptx");

      // Open Google Slides upload page in a new tab
      window.open("https://slides.google.com/", "_blank", "noopener");

      toast.info(
        "PPTX downloaded. In Google Slides, open File → Import slides to convert it.",
        { duration: 10000 }
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const isLoading = loading !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          {label}
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Download</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={downloadPptx}
          disabled={isLoading}
          className="cursor-pointer"
        >
          <Download className="text-blue-400" />
          PowerPoint (.pptx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={downloadPdf}
          disabled={isLoading}
          className="cursor-pointer"
        >
          <FileText className="text-red-400" />
          PDF (.pdf)
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Open in</DropdownMenuLabel>

        <DropdownMenuItem
          onClick={openInCanva}
          disabled={isLoading}
          className="cursor-pointer"
        >
          <ExternalLink className="text-purple-400" />
          Edit in Canva
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={exportToGoogleSlides}
          disabled={isLoading}
          className="cursor-pointer"
        >
          <ExternalLink className="text-green-400" />
          Export to Google Slides
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
