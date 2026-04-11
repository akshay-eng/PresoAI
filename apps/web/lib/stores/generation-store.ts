"use client";

import { create } from "zustand";

interface OutlineItem {
  title: string;
  layout: string;
  key_points: string[];
  notes: string;
}

interface StepStatus {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  message?: string;
  durationMs?: number;
}

interface GenerationState {
  jobId: string | null;
  phase: string;
  progress: number;
  message: string;
  outline: OutlineItem[];
  slides: unknown[];
  isGenerating: boolean;
  error: string | null;
  steps: StepStatus[];
  researchSummary: string;
  quality: number | null;
  reflectionIssues: string[];
  presentationId: string | null;

  setJobId: (jobId: string) => void;
  updateProgress: (phase: string, progress: number, message: string, data?: unknown) => void;
  setOutline: (outline: OutlineItem[]) => void;
  setSlides: (slides: unknown[]) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const STEP_DEFINITIONS: Array<{ name: string; label: string; phases: string[] }> = [
  { name: "extract_template", label: "Extracting theme", phases: ["extract_template"] },
  { name: "process_references", label: "Processing references", phases: ["process_references"] },
  { name: "research", label: "Researching topic", phases: ["researching"] },
  { name: "synthesize", label: "Synthesizing findings", phases: ["synthesizing"] },
  { name: "plan", label: "Planning slides", phases: ["planning", "outline_ready"] },
  { name: "write", label: "Writing content", phases: ["writing_slides"] },
  { name: "reflect", label: "Quality review", phases: ["reflecting", "reflection_done", "reflection_skipped"] },
  { name: "build", label: "Building PPTX", phases: ["agent_complete", "building_pptx", "injecting_theme", "generating_thumbnails", "finalizing"] },
];

function buildSteps(currentPhase: string): StepStatus[] {
  let foundCurrent = false;
  return STEP_DEFINITIONS.map((def) => {
    const isCurrentStep = def.phases.includes(currentPhase);
    if (isCurrentStep) foundCurrent = true;

    let status: StepStatus["status"] = "pending";
    if (isCurrentStep) {
      status = "running";
    } else if (!foundCurrent) {
      status = "done";
    }

    return { name: def.name, label: def.label, status };
  });
}

export const useGenerationStore = create<GenerationState>((set) => ({
  jobId: null,
  phase: "",
  progress: 0,
  message: "",
  outline: [],
  slides: [],
  isGenerating: false,
  error: null,
  steps: [],
  researchSummary: "",
  quality: null,
  reflectionIssues: [],
  presentationId: null,

  setJobId: (jobId) => set({
    jobId,
    isGenerating: true,
    error: null,
    steps: STEP_DEFINITIONS.map((d) => ({ name: d.name, label: d.label, status: "pending" as const })),
  }),

  updateProgress: (phase, progress, message, data) => {
    set((state) => {
      const updates: Partial<GenerationState> = {
        phase,
        progress,
        message,
        steps: buildSteps(phase),
      };

      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (d.outline) updates.outline = d.outline as OutlineItem[];
        if (d.slides) updates.slides = d.slides as unknown[];
        if (d.quality) updates.quality = d.quality as number;
        if (d.issues) updates.reflectionIssues = d.issues as string[];
        if (d.presentationId) updates.presentationId = d.presentationId as string;
      }

      if (phase === "complete") {
        updates.isGenerating = false;
        updates.steps = STEP_DEFINITIONS.map((d) => ({ name: d.name, label: d.label, status: "done" as const }));
      }

      if (phase === "failed") {
        updates.isGenerating = false;
        updates.error = message;
      }

      return updates;
    });
  },

  setOutline: (outline) => set({ outline }),
  setSlides: (slides) => set({ slides }),
  setError: (error) => set({ error, isGenerating: false }),
  reset: () =>
    set({
      jobId: null,
      phase: "",
      progress: 0,
      message: "",
      outline: [],
      slides: [],
      isGenerating: false,
      error: null,
      steps: [],
      researchSummary: "",
      quality: null,
      reflectionIssues: [],
      presentationId: null,
    }),
}));
