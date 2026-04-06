"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { ArrowLeft, Download, ExternalLink, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { api } from "@/lib/api-client";

const ease = [0.22, 1, 0.36, 1] as const;

interface PresentationPageProps {
  params: Promise<{ id: string }>;
}

export default function PresentationPage({ params }: PresentationPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession({ required: true });
  const [activeSlide, setActiveSlide] = useState(0);

  const { data: presentation, isLoading } = useQuery({
    queryKey: ["presentation", id],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!session,
  });

  const pres = presentation as {
    id: string;
    output?: {
      s3Key?: string;
      thumbnails?: string[];
      slideCount?: number;
      presentationId?: string;
    };
    presentations?: Array<{
      id: string;
      title: string;
      thumbnails?: string[];
      slideCount: number;
      version: number;
      s3Key: string;
    }>;
  } | null;

  const thumbnails = pres?.output?.thumbnails || pres?.presentations?.[0]?.thumbnails || [];
  const thumbnailList = Array.isArray(thumbnails) ? thumbnails : [];
  const slideCount = pres?.output?.slideCount || pres?.presentations?.[0]?.slideCount || 0;
  const presTitle = pres?.presentations?.[0]?.title || "Presentation";

  if (isLoading) {
    return (
      <div className="min-h-screen flex">
        <AppSidebar />
        <div className="flex-1 ml-[72px] px-6 py-8">
          <Skeleton className="h-6 w-48 mb-8" />
          <Skeleton className="h-[460px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <AppSidebar />
      <div className="flex-1 ml-[72px]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto flex h-12 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => router.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Link href="/dashboard" className="flex items-center gap-1.5">
              <div className="h-5 w-5 rounded bg-primary flex items-center justify-center">
                <Layers className="h-2.5 w-2.5 text-primary-foreground" />
              </div>
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-sm font-medium">{presTitle}</span>
            <Badge variant="secondary">{slideCount} slides</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const presId = pres?.output?.presentationId || pres?.presentations?.[0]?.id;
                  if (presId) {
                    const result = await api.openInMicrosoft(presId);
                    window.open(result.editUrl, "_blank");
                  }
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              PowerPoint
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const presId = pres?.output?.presentationId || pres?.presentations?.[0]?.id;
                  if (presId) {
                    const result = await api.importToCanva(presId);
                    window.open(result.editUrl, "_blank");
                  }
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Canva
            </Button>
          </div>
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
        className="max-w-6xl mx-auto px-6 py-6"
      >
        <div className="grid grid-cols-12 gap-4">
          {/* Thumbnails */}
          <div className="col-span-2 space-y-1.5 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
            {(thumbnailList.length > 0 ? thumbnailList : Array.from({ length: slideCount || 5 })).map((_, i) => (
              <button
                key={i}
                className={`w-full rounded-lg border-2 transition-colors duration-150 ${
                  activeSlide === i
                    ? "border-primary"
                    : "border-transparent hover:border-border"
                }`}
                onClick={() => setActiveSlide(i)}
              >
                <div className="aspect-[16/9] bg-muted rounded-md flex items-center justify-center text-xs text-muted-foreground">
                  {i + 1}
                </div>
              </button>
            ))}
          </div>

          {/* Viewer */}
          <div className="col-span-10">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="aspect-[16/9] bg-muted flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <p className="text-lg font-medium">Slide {activeSlide + 1}</p>
                  <p className="text-sm mt-0.5">Preview</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3 mt-4">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={activeSlide === 0}
                onClick={() => setActiveSlide((s) => Math.max(0, s - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums min-w-[48px] text-center">
                {activeSlide + 1} / {slideCount || thumbnailList.length || "?"}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={activeSlide >= (slideCount || thumbnailList.length) - 1}
                onClick={() => setActiveSlide((s) => s + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
      </div>
    </div>
  );
}
