"use client";

import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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

// Per-project generation slot. Keyed by projectId so two projects with
// in-flight jobs don't clobber each other when the user switches between
// them. Persisted to localStorage so progress survives page navigation and
// browser refresh — the SSE / poll loop re-attaches on mount using the
// stored jobId.
// Structured error envelope produced by the python-agent's error classifier.
// All fields optional so older / unclassified failures still render with the
// legacy `error` string.
export interface JobError {
  code?: string;
  title?: string;
  message?: string;
  hint?: string;
  provider?: string | null;
  retryable?: boolean;
}

interface JobSlot {
  jobId: string | null;
  phase: string;
  progress: number;
  message: string;
  outline: OutlineItem[];
  slides: unknown[];
  isGenerating: boolean;
  error: string | null;
  errorDetails: JobError | null;
  steps: StepStatus[];
  researchSummary: string;
  quality: number | null;
  reflectionIssues: string[];
  presentationId: string | null;
  // 1-indexed slide number currently being rendered by the node-worker
  // (0 when nothing is in flight). Used by the sidebar to mark slides
  // 1..currentSlideIndex-1 as done and only animate the active one.
  currentSlideIndex: number;
  totalSlidesBuilding: number;
  // When did we last hear from the worker? Used by the project page on mount
  // to decide whether to show the in-flight panel or trust the stored state
  // is fresh enough.
  lastEventAt: number | null;
}

interface GenerationState {
  // projectId -> JobSlot. Empty for projects without any prior generation.
  slots: Record<string, JobSlot>;

  // ── Read helpers (selectors) ──────────────────────────────────────────
  getSlot: (projectId: string) => JobSlot;

  // ── Write helpers (actions) ───────────────────────────────────────────
  setJobId: (projectId: string, jobId: string) => void;
  updateProgress: (
    projectId: string,
    phase: string,
    progress: number,
    message: string,
    data?: unknown,
  ) => void;
  setOutline: (projectId: string, outline: OutlineItem[]) => void;
  setSlides: (projectId: string, slides: unknown[]) => void;
  setError: (projectId: string, error: string | null) => void;
  reset: (projectId: string) => void;

  // Used by the active-job reconciliation on mount: replace the slot wholesale
  // with whatever the server says is the current state. Avoids re-rendering
  // through dozens of incremental updates.
  hydrate: (projectId: string, slot: Partial<JobSlot>) => void;
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

function emptySlot(): JobSlot {
  return {
    jobId: null,
    phase: "",
    progress: 0,
    message: "",
    outline: [],
    slides: [],
    isGenerating: false,
    error: null,
    errorDetails: null,
    steps: [],
    researchSummary: "",
    quality: null,
    reflectionIssues: [],
    presentationId: null,
    currentSlideIndex: 0,
    totalSlidesBuilding: 0,
    lastEventAt: null,
  };
}

export const useGenerationStore = create<GenerationState>()(
  persist(
    (set, get) => ({
      slots: {},

      getSlot: (projectId) => get().slots[projectId] || emptySlot(),

      setJobId: (projectId, jobId) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [projectId]: {
              ...(state.slots[projectId] || emptySlot()),
              jobId,
              isGenerating: true,
              error: null,
              steps: STEP_DEFINITIONS.map((d) => ({
                name: d.name,
                label: d.label,
                status: "pending" as const,
              })),
              lastEventAt: Date.now(),
            },
          },
        })),

      updateProgress: (projectId, phase, progress, message, data) =>
        set((state) => {
          const existing = state.slots[projectId] || emptySlot();
          const updates: Partial<JobSlot> = {
            phase,
            progress,
            message,
            steps: buildSteps(phase),
            lastEventAt: Date.now(),
          };

          if (data && typeof data === "object") {
            const d = data as Record<string, unknown>;
            if (d.outline) updates.outline = d.outline as OutlineItem[];
            if (d.slides) updates.slides = d.slides as unknown[];
            if (d.quality) updates.quality = d.quality as number;
            if (d.issues) updates.reflectionIssues = d.issues as string[];
            if (d.presentationId) updates.presentationId = d.presentationId as string;
            // Per-slide build progress from node-worker. `currentSlideIndex`
            // is 1-indexed; the value carries through the SSE stream and
            // the sidebar uses it to render slide-level done/active states.
            if (typeof d.currentSlideIndex === "number") {
              updates.currentSlideIndex = d.currentSlideIndex;
            }
            if (typeof d.totalSlides === "number") {
              updates.totalSlidesBuilding = d.totalSlides;
            }
          }

          // When the writing_slides phase ends and we transition into
          // building_pptx (but no per-slide tick has arrived yet), keep
          // currentSlideIndex at 0 so all slides show as "queued". The
          // first tick from the loop will flip them to active/done.
          if (phase === "writing_slides") {
            // During the LLM slide-writing step, we don't have true per-
            // slide signals (one LLM call → all slides). Reset the build
            // index so the sidebar doesn't show stale done-marks from a
            // previous build.
            updates.currentSlideIndex = 0;
          }

          if (phase === "complete") {
            updates.isGenerating = false;
            updates.steps = STEP_DEFINITIONS.map((d) => ({
              name: d.name,
              label: d.label,
              status: "done" as const,
            }));
          }

          if (phase === "failed") {
            updates.isGenerating = false;
            updates.error = message;
            // Capture the structured payload the worker now emits — code,
            // title, hint, etc. — so the chat can render an actionable
            // failure card instead of dumping the raw stack trace.
            if (data && typeof data === "object") {
              const d = data as Record<string, unknown>;
              if (typeof d.errorCode === "string") {
                updates.errorDetails = {
                  code: d.errorCode,
                  title: typeof d.errorTitle === "string" ? d.errorTitle : undefined,
                  message: typeof d.errorMessage === "string" ? d.errorMessage : undefined,
                  hint: typeof d.errorHint === "string" ? d.errorHint : undefined,
                  provider: typeof d.errorProvider === "string" ? d.errorProvider : null,
                  retryable: d.errorRetryable === true,
                };
              }
            }
          }

          return {
            slots: { ...state.slots, [projectId]: { ...existing, ...updates } },
          };
        }),

      setOutline: (projectId, outline) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [projectId]: { ...(state.slots[projectId] || emptySlot()), outline },
          },
        })),

      setSlides: (projectId, slides) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [projectId]: { ...(state.slots[projectId] || emptySlot()), slides },
          },
        })),

      setError: (projectId, error) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [projectId]: {
              ...(state.slots[projectId] || emptySlot()),
              error,
              isGenerating: false,
            },
          },
        })),

      reset: (projectId) =>
        set((state) => {
          const next = { ...state.slots };
          delete next[projectId];
          return { slots: next };
        }),

      hydrate: (projectId, partial) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [projectId]: { ...(state.slots[projectId] || emptySlot()), ...partial },
          },
        })),
    }),
    {
      name: "slideforge-generation",
      // Skip persisting closures/etc — only persist the slots dictionary.
      partialize: (state) => ({ slots: state.slots }),
      // Drop ancient slots: anything older than 24h that's not actively
      // generating is unlikely to be useful and just bloats localStorage.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const now = Date.now();
        const fresh: Record<string, JobSlot> = {};
        for (const [pid, slot] of Object.entries(state.slots || {})) {
          const ageMs = slot.lastEventAt ? now - slot.lastEventAt : Infinity;
          if (slot.isGenerating || ageMs < 24 * 60 * 60 * 1000) {
            fresh[pid] = slot;
          }
        }
        state.slots = fresh;
      },
    },
  ),
);

// Convenience hook — picks a single project's slot and exposes action
// closures pre-bound to that projectId. Use this in components so the call
// sites read like the old single-slot API (without the projectId arg on
// every call).
//
// CRITICAL: all returned action closures are memoized with useCallback so
// downstream useEffect dependency arrays don't re-fire on every render.
// Without this, effects that include any of these in their deps (e.g. the
// active-job reconcile) would re-run on every parent render, racing
// against themselves and breaking auto-generation + notifications.
export function useProjectGeneration(projectId: string) {
  const slot = useGenerationStore((s) => s.slots[projectId]) || emptySlot();
  const setJobIdRaw = useGenerationStore((s) => s.setJobId);
  const updateProgressRaw = useGenerationStore((s) => s.updateProgress);
  const setOutlineRaw = useGenerationStore((s) => s.setOutline);
  const setSlidesRaw = useGenerationStore((s) => s.setSlides);
  const setErrorRaw = useGenerationStore((s) => s.setError);
  const resetRaw = useGenerationStore((s) => s.reset);
  const hydrateRaw = useGenerationStore((s) => s.hydrate);

  const setJobId = useCallback(
    (jobId: string) => setJobIdRaw(projectId, jobId),
    [projectId, setJobIdRaw],
  );
  const updateProgress = useCallback(
    (phase: string, progress: number, message: string, data?: unknown) =>
      updateProgressRaw(projectId, phase, progress, message, data),
    [projectId, updateProgressRaw],
  );
  const setOutline = useCallback(
    (outline: OutlineItem[]) => setOutlineRaw(projectId, outline),
    [projectId, setOutlineRaw],
  );
  const setSlides = useCallback(
    (slides: unknown[]) => setSlidesRaw(projectId, slides),
    [projectId, setSlidesRaw],
  );
  const setError = useCallback(
    (error: string | null) => setErrorRaw(projectId, error),
    [projectId, setErrorRaw],
  );
  const reset = useCallback(() => resetRaw(projectId), [projectId, resetRaw]);
  const hydrate = useCallback(
    (partial: Partial<JobSlot>) => hydrateRaw(projectId, partial),
    [projectId, hydrateRaw],
  );

  return {
    ...slot,
    setJobId,
    updateProgress,
    setOutline,
    setSlides,
    setError,
    reset,
    hydrate,
  };
}
