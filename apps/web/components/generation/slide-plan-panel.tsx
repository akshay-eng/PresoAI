"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Layout, Type, BarChart3, Image, List, Columns, Presentation } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const ease = [0.22, 1, 0.36, 1] as const;

interface SlideOutlineItem {
  title: string;
  layout: string;
  key_points: string[];
}

interface SlidePlanPanelProps {
  outline: SlideOutlineItem[];
  phase: string;
  progress: number;
  message?: string;
}

const LAYOUT_ICONS: Record<string, React.ElementType> = {
  title: Presentation,
  "title-content": Type,
  "two-column": Columns,
  "content-only": List,
  chart: BarChart3,
  image: Image,
  blank: Layout,
};

const PHASE_STAGE: Record<string, { label: string; step: number }> = {
  starting: { label: "Initializing", step: 0 },
  extract_template: { label: "Extracting template", step: 1 },
  process_references: { label: "Reading references", step: 1 },
  researching: { label: "Researching topic", step: 2 },
  synthesizing: { label: "Synthesizing research", step: 3 },
  planning: { label: "Planning slides", step: 4 },
  awaiting_review: { label: "Outline ready", step: 5 },
  outline_approved: { label: "Approved", step: 5 },
  writing_slides: { label: "Writing content", step: 6 },
  building_pptx: { label: "Building PPTX", step: 7 },
  injecting_theme: { label: "Applying theme", step: 7 },
  generating_thumbnails: { label: "Generating previews", step: 8 },
  finalizing: { label: "Finalizing", step: 8 },
  reflecting: { label: "Quality check", step: 8 },
  agent_complete: { label: "Almost done", step: 8 },
  complete: { label: "Done", step: 9 },
  failed: { label: "Failed", step: -1 },
};

export function SlidePlanPanel({ outline, phase, progress, message }: SlidePlanPanelProps) {
  const stage = PHASE_STAGE[phase] || { label: phase, step: 0 };
  const isPlanning = stage.step >= 2 && stage.step <= 5;
  const isWriting = stage.step >= 6;
  const isDone = phase === "complete";

  return (
    <div className="h-full flex flex-col">
      {/* Pipeline steps */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">Generation pipeline</p>
        <div className="space-y-1">
          {[
            { step: 1, label: "Process inputs" },
            { step: 2, label: "Research topic" },
            { step: 3, label: "Synthesize findings" },
            { step: 4, label: "Plan slides" },
            { step: 6, label: "Write content" },
            { step: 7, label: "Build PPTX" },
            { step: 9, label: "Complete" },
          ].map((s) => {
            const isActive = stage.step === s.step;
            const isComplete = stage.step > s.step;
            const isPending = stage.step < s.step;

            return (
              <div
                key={s.step}
                className={`flex items-center gap-2.5 py-1 text-xs transition-colors duration-300 ${
                  isActive ? "text-foreground font-medium" :
                  isComplete ? "text-primary" :
                  "text-muted-foreground/40"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
                  isActive ? "bg-primary animate-pulse" :
                  isComplete ? "bg-primary" :
                  "bg-muted-foreground/20"
                }`} />
                <span>{s.label}</span>
                {isActive && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary ml-auto" />
                )}
                {isComplete && (
                  <span className="ml-auto text-[10px] text-primary">Done</span>
                )}
              </div>
            );
          })}
        </div>
        {message && (
          <p className="text-[11px] text-muted-foreground mt-2 pl-4">{message}</p>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border/60 mx-5" />

      {/* Slide cards — appear as they're planned */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {outline.length === 0 && !isDone && (
          <div className="text-center pt-8">
            {isPlanning ? (
              <>
                <div className="flex justify-center gap-1 mb-3">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-16 h-10 rounded-md bg-muted"
                      animate={{ opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 1.5, delay: i * 0.2, repeat: Infinity }}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Planning your slides...</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Slide plan will appear here as the AI works
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {outline.map((slide, i) => {
            const LayoutIcon = LAYOUT_ICONS[slide.layout] || Layout;

            return (
              <motion.div
                key={`slide-${i}`}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.4, delay: i * 0.08, ease }}
                className="mb-3"
              >
                <div className={`rounded-lg border bg-background p-3 transition-colors ${
                  isWriting && phase === "writing_slides"
                    ? "border-primary/20"
                    : "border-border"
                }`}>
                  {/* Slide header */}
                  <div className="flex items-start gap-2.5">
                    {/* Mini slide thumbnail skeleton */}
                    <div className="w-14 h-9 rounded bg-muted shrink-0 flex items-center justify-center">
                      <span className="text-[9px] font-medium text-muted-foreground">{i + 1}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-medium truncate">{slide.title}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <LayoutIcon className="h-3 w-3 text-muted-foreground/50" />
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0">{slide.layout}</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Key points */}
                  {slide.key_points.length > 0 && (
                    <div className="mt-2 pl-[66px] space-y-0.5">
                      {slide.key_points.map((point, j) => (
                        <p key={j} className="text-[11px] text-muted-foreground leading-relaxed">
                          {point}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Writing indicator */}
                  {isWriting && !isDone && (
                    <motion.div
                      className="mt-2 pl-[66px]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                    >
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className="h-full bg-primary/40 rounded-full"
                          animate={{ x: ["-100%", "100%"] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                          style={{ width: "40%" }}
                        />
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Done state */}
        {isDone && outline.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4, ease }}
            className="text-center pt-4 pb-2"
          >
            <p className="text-xs text-primary font-medium">
              All {outline.length} slides generated
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
