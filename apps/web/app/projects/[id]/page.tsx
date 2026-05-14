"use client";

import { useState, use, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Sparkles,
  Settings2,
  X,
  Loader2,
  Send,
  Check,
  Download,
  ExternalLink,
  Edit2,
  ChevronRight,
  Plus,
  Upload,
  FileText,
  Palette,
  Brain,
  Paperclip,
  Eye,
  PenTool,
  BarChart3,
  Square,
  Copy as CopyIcon,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileUpload, FileListItem } from "@/components/project/file-upload";
import { FilePicker } from "@/components/project/file-picker";
import { ThemePreview } from "@/components/project/theme-preview";
import { LLMSelector } from "@/components/project/llm-selector";
import { StyleProfileSelector } from "@/components/project/style-profile-selector";
import { StyleProfileViewer } from "@/components/project/style-profile-viewer";
import { MemoryDrawer } from "@/components/project/memory-drawer";
import { useProjectGeneration, useGenerationStore } from "@/lib/stores/generation-store";
import { useChatStore, type ChatMessage } from "@/lib/stores/chat-store";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { LottieAnimation } from "@/components/lottie-animation";
import { SlidePlanPanel } from "@/components/generation/slide-plan-panel";
import { JobErrorCard } from "@/components/generation/job-error-card";
import { PptxPreview } from "@/components/generation/pptx-preview";
import { CollaboraEditor } from "@/components/generation/collabora-editor";
import { api } from "@/lib/api-client";
import { classifyIntent } from "@/lib/intent";
import { buildCompletionSummary } from "@/lib/completion-summary";

const ease = [0.22, 1, 0.36, 1] as const;
const EMPTY_MESSAGES: ChatMessage[] = [];

const PHASE_LABELS: Record<string, string> = {
  starting: "Starting generation...",
  extract_template: "Extracting theme from your template...",
  process_references: "Processing your reference files...",
  researching: "Researching your topic...",
  synthesizing: "Synthesizing research findings...",
  planning: "Planning the slide outline...",
  awaiting_review: "Outline ready for your review",
  outline_approved: "Outline approved! Writing slides...",
  writing_slides: "Writing slide content...",
  awaiting_content_review: "Content ready for review",
  building_pptx: "Building your PowerPoint file...",
  injecting_theme: "Applying your theme...",
  generating_thumbnails: "Generating previews...",
  finalizing: "Saving your presentation...",
  reflecting: "Running quality check...",
  reflection_done: "Quality check passed",
  reflection_revised: "Slides revised for quality",
  reflection_skipped: "Skipping quality check",
  agent_complete: "Building final PPTX...",
  complete: "Your presentation is ready!",
  failed: "Generation failed",
};

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession({ required: true });
  const [autoGenerateHandled, setAutoGenerateHandled] = useState(false);
  const queryClient = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const {
    setJobId, isGenerating, jobId, phase, progress, message, outline, error,
    errorDetails, updateProgress, presentationId: completedPresentationId, hydrate,
  } = useProjectGeneration(id);

  const addMessage = useChatStore((s) => s.addMessage);
  const getMessages = useChatStore((s) => s.getMessages);
  const updateLastAssistantMessage = useChatStore((s) => s.updateLastAssistantMessage);
  const chatMessages = useChatStore((s) => s.chats[id]?.messages) || EMPTY_MESSAGES;

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

  // ── Active-job reconciliation on mount ───────────────────────────────
  // The BullMQ worker keeps running on the backend even if the user
  // navigates away. This effect re-attaches the UI to whatever job is
  // currently in flight (or recently completed) for this project so the
  // progress panel resumes instead of restarting.
  //
  // Runs once per project mount. If the store already has a fresh
  // generating slot for this project, we skip the round-trip — SSE will
  // re-attach via the other effect.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const r = await fetch(`/api/projects/${id}/active-job`);
        if (cancelled) return;
        // Project no longer exists in the DB — wipe any persisted in-flight
        // slot so the UI stops showing "processing/pending" for a zombie
        // project. The router will already redirect on the project fetch,
        // but the generation panel reads from the persistent store which
        // would otherwise outlive the deletion.
        if (r.status === 404) {
          useGenerationStore.getState().reset(id);
          return;
        }
        if (!r.ok) return;
        const j = (await r.json()) as {
          status?: string | null;
          jobId?: string;
          isTerminal?: boolean;
          progress?: number;
          currentPhase?: string;
          output?: Record<string, unknown> | null;
          error?: string | null;
        };
        if (cancelled) return;
        if (!j.status || !j.jobId) return; // no jobs yet for this project

        // Always reconcile against the server's reality. The persisted slot
        // can hold stale "starting" state from the initial submit, or a
        // partial in-flight phase from before the user navigated away.
        // Server-side currentPhase/progress is the source of truth.
        const known = useGenerationStore.getState().slots[id];
        if (!j.isTerminal) {
          // In-flight — hydrate store so SSE useEffect (below) reattaches.
          // Only overwrite phase/progress if the server has a more recent
          // value than what we have locally (avoids snapping back to an
          // older phase while SSE was about to deliver the next one).
          const serverProgress = typeof j.progress === "number" ? j.progress : 0;
          const localProgress = known?.progress ?? 0;
          hydrate({
            jobId: j.jobId,
            isGenerating: true,
            phase:
              serverProgress >= localProgress
                ? j.currentPhase || known?.phase || "starting"
                : known?.phase || "starting",
            progress: Math.max(serverProgress, localProgress),
            message: known?.message || "Resuming…",
            error: null,
            lastEventAt: Date.now(),
          });
        } else if (j.status === "COMPLETED" && j.output) {
          // Terminal — fold completion data into store. Re-hydrate even if
          // the jobId matches, because the persisted slot may be mid-flight
          // from before the worker actually finished (which is exactly the
          // case where the user left mid-build and came back to a deck
          // that's now ready).
          const sameJobAndComplete =
            known?.jobId === j.jobId && known?.phase === "complete";
          if (!sameJobAndComplete) {
            hydrate({
              jobId: j.jobId,
              isGenerating: false,
              phase: "complete",
              progress: 1,
              presentationId: (j.output.presentationId as string) || known?.presentationId || null,
              message: "Presentation ready!",
              lastEventAt: Date.now(),
            });
          }
        } else if (j.status === "FAILED") {
          hydrate({
            jobId: j.jobId,
            isGenerating: false,
            phase: "failed",
            error: j.error || "Generation failed",
            lastEventAt: Date.now(),
          });
        }
      } catch {
        // Best-effort — silent failure means UI just won't auto-resume.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, hydrate]);

  // When generation progress updates, save as assistant message
  // Track which job phases have been saved to avoid duplicate chat messages
  const savedPhasesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!jobId || !id) return;
    const key = `${jobId}:${phase}`;
    if (savedPhasesRef.current.has(key)) return;

    // Check if this message already exists in chat history (prevents duplicates on re-render)
    const existingMsgs = getMessages(id);
    const alreadyExists = existingMsgs.some(
      (m) => m.metadata?.jobId === jobId && m.metadata?.phase === phase
    );
    if (alreadyExists) {
      savedPhasesRef.current.add(key);
      return;
    }

    // Only terminal phases land in the chat log. Mid-flight phases are shown
    // as transient text next to the progress bar via the generation store and
    // disappear once the job completes.
    if (phase === "complete") {
      savedPhasesRef.current.add(key);
      // Distinguish edit-completion from fresh-build completion so the chat
      // narration matches what the user actually asked for.
      const editCtx = pendingEditRef.current;
      pendingEditRef.current = null;
      const summary = buildCompletionSummary({
        outline,
        slideCount: outline.length || numSlides,
        engine,
        audience: audienceType,
        asEdit: editCtx ? { instruction: editCtx.instruction, targetSlides: editCtx.targetSlides } : undefined,
      });
      addMessage(id, {
        role: "assistant",
        content: summary,
        metadata: {
          phase: "complete",
          jobId,
          presentationId: completedPresentationId || undefined,
          outline: outline.length > 0 ? outline.map((o) => ({ title: o.title })) : undefined,
          mode: editCtx ? "edit" : "generate",
        },
      });
      setActivePanel("preview");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    } else if (phase === "failed" && error) {
      savedPhasesRef.current.add(key);
      // Persist the structured error envelope so the chat card renders
      // identically after a refresh — without it we'd fall back to the raw
      // error string and lose the actionable hint/buttons.
      addMessage(id, {
        role: "system",
        content: errorDetails?.title
          ? `${errorDetails.title} — ${errorDetails.message ?? error}`
          : `Generation failed: ${error}`,
        metadata: {
          phase: "failed",
          jobId,
          error,
          errorDetails: errorDetails ?? undefined,
        },
      });
    }
  }, [phase, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [prompt, setPrompt] = useState("");
  const [numSlides, setNumSlides] = useState(10);
  const [audienceType, setAudienceType] = useState("general");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"claude-code" | "preso-plus" | "node-worker" | "preso-pro">("node-worker");
  const [creativeMode, setCreativeMode] = useState(false);
  const [useDiagramImages, setUseDiagramImages] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pastedImages, setPastedImages] = useState<Array<{ key: string; previewUrl: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [activePanel, setActivePanel] = useState<"none" | "outline" | "plan" | "preview" | "files" | "editor" | "template" | "references" | "model" | "style" | "engine">("none");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [latestPresentationId, setLatestPresentationId] = useState<string | null>(null);
  const [editingOutline, setEditingOutline] = useState(false);
  const [editedOutline, setEditedOutline] = useState<typeof outline>([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
    enabled: !!session,
  });

  const p = project as {
    id: string;
    name: string;
    prompt: string;
    numSlides: number;
    audienceType: string;
    template?: { id: string; name: string; themeConfig: unknown; extractionStatus: string };
    referenceFiles: Array<{ id: string; fileName: string; extractionStatus: string; fileSize: number }>;
    presentations: Array<{ id: string; title: string; version: number; slideCount: number }>;
    llmConfig?: { id: string };
  } | null;

  // When a new generation/edit completes a fresh presentation lands at the
  // top of `p.presentations`. Snap the version dropdown to that new latest
  // so the user sees the freshest deck — unless they had explicitly picked
  // an older version that still exists, in which case respect their choice.
  const latestRenderedId = p?.presentations?.[0]?.id;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!latestRenderedId) return;
    const stillExists = !!p?.presentations?.find((pp) => pp.id === latestPresentationId);
    if (!latestPresentationId || !stillExists) {
      setLatestPresentationId(latestRenderedId);
    }
  }, [latestRenderedId]);

  // Load models list for auto-select
  const { data: modelsData } = useQuery({
    queryKey: ["llm-models"],
    queryFn: () => api.listModels(),
    enabled: !!session,
  });
  const modelList = (() => {
    const d = modelsData as { models?: unknown[] } | unknown[] | undefined;
    return (Array.isArray(d) ? d : (d?.models || [])) as Array<{ id: string; name: string; isDefault: boolean }>;
  })();

  // Auto-select default model if none is set
  useEffect(() => {
    if (!selectedModelId && modelList.length > 0) {
      const def = modelList.find((m) => m.isDefault) || modelList[0];
      if (def) setSelectedModelId(def.id);
    }
  }, [modelList, selectedModelId]);

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (p && !initialized) {
      setNumSlides(p.numSlides || 10);
      setAudienceType(p.audienceType || "general");
      setProjectName(p.name || "");
      if (p.llmConfig) setSelectedModelId(p.llmConfig.id);

      const hasMessages = chatMessages.length > 0;
      const hasPresentations = (p.presentations?.length || 0) > 0;
      const shouldAutoGenerate = searchParams.get("autoGenerate") === "1";
      const modelFromUrl = searchParams.get("modelId");

      if (p.prompt || hasMessages || hasPresentations) {
        setHasSubmitted(true);
        setSubmittedPrompt(p.prompt || "");
        setPrompt("");

        // Only add initial messages if the chat is truly empty (no messages at all)
        // Use getMessages() which reads directly from the store (includes hydrated localStorage)
        const currentMsgs = getMessages(id);
        if (p.prompt && currentMsgs.length === 0) {
          addMessage(id, {
            role: "user",
            content: p.prompt,
            metadata: { audienceType: p.audienceType, numSlides: p.numSlides },
          });
          if (hasPresentations) {
            addMessage(id, {
              role: "assistant",
              content: buildCompletionSummary({
                outline: [],
                slideCount: p.presentations?.[0]?.slideCount ?? p.numSlides ?? 0,
                engine: "node-worker",
                audience: p.audienceType || "general",
              }),
              metadata: { phase: "complete" },
            });
          }
        }

        // Auto-open preview if there are presentations
        if (hasPresentations) {
          setActivePanel("preview");
        }
      } else if (!p.prompt) {
        setPrompt("");
      }

      // Read ALL settings from URL params (passed from dashboard) — these take priority
      if (searchParams.get("creativeMode") === "1") setCreativeMode(true);
      const urlNumSlides = searchParams.get("numSlides");
      if (urlNumSlides) setNumSlides(parseInt(urlNumSlides, 10));
      const urlAudience = searchParams.get("audienceType");
      if (urlAudience) setAudienceType(urlAudience);
      if (searchParams.get("useDiagramImages") === "1") setUseDiagramImages(true);

      // Auto-generate if coming from dashboard
      if (shouldAutoGenerate && p.prompt && modelFromUrl && !autoGenerateHandled) {
        setSelectedModelId(modelFromUrl);
        // Persist model to project so it survives page reloads and follow-ups
        api.updateProject(id, { llmConfigId: modelFromUrl }).catch(() => {});
        const engineFromUrl = searchParams.get("engine") as typeof engine | null;
        if (engineFromUrl) setEngine(engineFromUrl);
        setAutoGenerateHandled(true);
        setPrompt("");
        router.replace(`/projects/${id}`, { scroll: false });
      }

      // If no model selected yet, pick from URL or default
      if (!selectedModelId && !modelFromUrl && !p.llmConfig) {
        // Will be picked up by the auto-select effect below
      }

      setInitialized(true);
    }
  }, [p, initialized, chatMessages.length]);

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.updateProject(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });

  const deleteRefMutation = useMutation({
    mutationFn: async (refId: string) => {
      const res = await fetch(`/api/references/${refId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      toast.success("Reference file deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      toast.success("Template deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.generate(id, {
        prompt: submittedPrompt,
        numSlides,
        audienceType,
        modelId: selectedModelId,
        engine,
        creativeMode,
        useDiagramImages,
        chatImageKeys: chatMessages
          .filter((m) => m.metadata?.imageKeys)
          .flatMap((m) => (m.metadata!.imageKeys as string[]) || []),
      }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setActivePanel("plan");
      addMessage(id, {
        role: "assistant",
        content: `Starting presentation generation using ${engine === "preso-pro" ? "Preso Pro" : engine === "preso-plus" ? "Preso Plus" : engine === "claude-code" ? "Preso Code" : "Preso Elite"} engine${creativeMode ? " with Creative Mode" : ""}...`,
        metadata: { phase: "starting", jobId: data.jobId, engine },
      });
      // Auto-open the plan panel to show live progress (Canva-like experience)
      setActivePanel("plan");
    },
    onError: (err: Error) => {
      toast.error(err.message);
      addMessage(id, {
        role: "system",
        content: `Failed to start generation: ${err.message}`,
        metadata: { error: err.message },
      });
    },
  });

  // The most recent edit instruction in flight — read by the completion
  // handler so the chat summary frames the result as "Done — applied your
  // edit to slide 3" instead of "Built a fresh 5-slide deck". Cleared on
  // completion. Ref (not state) because we don't need a re-render when it
  // changes; the SSE handler reads it inline.
  const pendingEditRef = useRef<{ instruction: string; targetSlides?: number[] } | null>(null);

  // Inline-edit state for user message bubbles. When set, the bubble with
  // this id renders a textarea instead of static text. Saving updates the
  // chat-store entry AND fires a follow-up so the agent iterates on the
  // edited prompt — same UX pattern as ChatGPT / Claude's edit-and-resend.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");

  // Which long-prompt bubbles the user has expanded. Long prompts collapse
  // by default to keep the chat column tidy when a preview/editor panel is
  // open alongside — otherwise a 1500-char structured brief dominates the
  // viewport and squeezes the preview.
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(() => new Set());

  // Surgical edit: patches the existing deck without re-running the full pipeline.
  // No chat narration — the live progress message renders next to the progress
  // bar (same as the initial generation flow) and disappears on completion.
  const editMutation = useMutation({
    mutationFn: (vars: { instruction: string; modelId: string; targetSlides?: number[] }) => {
      pendingEditRef.current = {
        instruction: vars.instruction,
        targetSlides: vars.targetSlides,
      };
      return api.editPresentation(id, vars);
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setActivePanel("plan");
    },
    onError: (err: Error) => {
      pendingEditRef.current = null;
      toast.error(err.message);
      addMessage(id, {
        role: "system",
        content: `Edit failed: ${err.message}`,
        metadata: { error: err.message, mode: "edit" },
      });
    },
  });

  // Auto-trigger generation when coming from dashboard
  useEffect(() => {
    if (autoGenerateHandled && selectedModelId && submittedPrompt && !jobId && !isGenerating && !generateMutation.isPending) {
      const t = setTimeout(() => generateMutation.mutate(), 300);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateHandled, selectedModelId, submittedPrompt]);

  // SSE with reconnection + poll fallback
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!jobId || !isGenerating) return;

    function connect() {
      if (eventSourceRef.current) eventSourceRef.current.close();
      const es = new EventSource(`/api/jobs/${jobId}/progress`);
      eventSourceRef.current = es;
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          updateProgress(data.phase, data.progress, data.message, data.data);
        } catch { /* ignore */ }
      };
      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        // Reconnect after 3s if still generating
        reconnectTimer.current = setTimeout(() => {
          if (isGenerating) connect();
        }, 3000);
      };
    }

    connect();

    // Poll fallback every 10s in case SSE misses the completion
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json() as { status?: string; output?: Record<string, unknown>; error?: string };
        if (job.status === "COMPLETED") {
          updateProgress("complete", 1.0, "Presentation ready!", job.output);
          clearInterval(pollInterval);
        } else if (job.status === "FAILED") {
          updateProgress("failed", 1.0, job.error || "Generation failed");
          clearInterval(pollInterval);
        }
      } catch { /* ignore */ }
    }, 10000);

    return () => {
      eventSourceRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      clearInterval(pollInterval);
    };
  }, [jobId, isGenerating, updateProgress]);

  useEffect(() => {
    if (outline.length > 0) {
      setEditedOutline(outline.map((o) => ({ ...o })));
      // Keep the plan panel open if it's already showing (don't switch to outline)
      if (activePanel !== "plan") {
        setActivePanel("plan");
      }
    }
  }, [outline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open the plan panel whenever a job is in flight for this project.
  // Covers the revisit case: user navigated away mid-generation and came
  // back — without this effect, `activePanel` resets to "none" on remount
  // and the user sees a blank page even though the job is still running.
  // Once the job hits a terminal phase the panel stays open so the user
  // can review what was generated.
  useEffect(() => {
    if (isGenerating && activePanel !== "plan" && activePanel !== "preview" && activePanel !== "editor") {
      setActivePanel("plan");
    }
  }, [isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, message, hasSubmitted]);

  // Close attach menu on click outside
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = () => setShowAttachMenu(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showAttachMenu]);

  async function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    if (!selectedModelId) {
      toast.error("Please select an AI model first (click + button)");
      return;
    }

    const currentPrompt = prompt.trim();

    // Save the user message to chat history immediately so they see it land.
    const imageKeys = pastedImages.map((img) => img.key);
    addMessage(id, {
      role: "user",
      content: currentPrompt,
      metadata: { audienceType, numSlides, engine, imageKeys: imageKeys.length > 0 ? imageKeys : undefined },
    });

    // Guardrail: classify the input. Greetings, off-topic, or vague-deck
    // requests get a friendly assistant reply in chat — no generation.
    const hasPresentation = (p?.presentations?.length || 0) > 0;
    try {
      const intent = await classifyIntent(currentPrompt, hasPresentation, { audience: audienceType, numSlides });
      if (intent.action !== "generate" && intent.action !== "edit") {
        addMessage(id, {
          role: "assistant",
          content: intent.reply ||
            "Tell me the topic, audience, and roughly how many slides — I'll build the deck from there.",
          metadata: { intent: intent.action, guardrail: true },
        });
        // Clear the input and stop here — no project update, no generation.
        setPrompt("");
        setPastedImages([]);
        if (textareaRef.current) {
          textareaRef.current.value = "";
          textareaRef.current.style.height = "auto";
        }
        return;
      }
    } catch { /* fall through to generation on classifier failure */ }

    setSubmittedPrompt(currentPrompt);
    setHasSubmitted(true);

    // Update project with prompt + params
    updateMutation.mutate({ prompt: currentPrompt, numSlides, audienceType });

    // Clear the input
    setPrompt("");
    setPastedImages([]);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }

    // Start generation immediately
    setTimeout(() => generateMutation.mutate(), 100);
  }

  async function handlePasteImage(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        setUploadingImage(true);
        try {
          // Get presigned URL
          const presignRes = await fetch("/api/upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: `pasted-${Date.now()}.png`,
              contentType: file.type,
              purpose: "chat-image",
            }),
          });
          if (!presignRes.ok) throw new Error("Presign failed");
          const { signedUrl, key } = await presignRes.json();

          // Upload to MinIO
          await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });

          // Create preview URL
          const previewUrl = URL.createObjectURL(file);
          setPastedImages((prev) => [...prev, { key, previewUrl }]);
          toast.success("Image attached");
        } catch (err) {
          toast.error("Failed to upload image");
        }
        setUploadingImage(false);
        break; // Only handle first image
      }
    }
  }

  async function handleSendFollowUp() {
    if (!prompt.trim()) return;

    const currentPrompt = prompt.trim();

    // Save follow-up as user message
    addMessage(id, {
      role: "user",
      content: currentPrompt,
      metadata: { audienceType, numSlides },
    });

    // Clear the input
    setPrompt("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }

    if (!selectedModelId) {
      toast.error("Select an AI model first");
      setActivePanel("model");
      return;
    }

    const hasPresentation = (p?.presentations?.length || 0) > 0;

    // Guardrail: classify the follow-up. If it's a greeting / off-topic /
    // vague request, reply in chat without kicking off any work.
    try {
      const intent = await classifyIntent(currentPrompt, hasPresentation, { audience: audienceType, numSlides });
      if (intent.action === "greeting" || intent.action === "decline" || intent.action === "clarify") {
        addMessage(id, {
          role: "assistant",
          content: intent.reply ||
            "Tell me what to change about the deck and I'll patch it.",
          metadata: { intent: intent.action, guardrail: true },
        });
        return;
      }
    } catch { /* fall through on classifier failure */ }

    // Intent routing: when an existing presentation is in this project AND the
    // message reads like a modification (the common case), surgically edit it
    // via /api/projects/:id/edit instead of re-running the whole pipeline.
    // Hard signals like "new deck"/"different topic"/"start over" still fall
    // through to a full regenerate.
    const wantsNewDeck = isNewDeckRequest(currentPrompt);

    if (hasPresentation && !wantsNewDeck) {
      const targetSlides = extractTargetSlideNumbers(currentPrompt);
      // No static placeholder — the python-agent + node-worker publish live
      // phase events ("starting" → "editing" → "rendering" → "building_pptx"
      // → "generating_thumbnails" → "complete") and the SSE listener pumps
      // each one into chat as a distinct assistant message, just like the
      // initial generation flow.
      editMutation.mutate({
        instruction: currentPrompt,
        modelId: selectedModelId,
        ...(targetSlides && targetSlides.length > 0 ? { targetSlides } : {}),
      });
      return;
    }

    // Full regenerate path. Build context so the model knows the previous
    // topic.
    const originalPrompt = p?.prompt || submittedPrompt || "";
    const contextPrompt = originalPrompt && hasPresentation
      ? `[FOLLOW-UP] Original deck topic: "${originalPrompt}"\n\nUser's modification request: ${currentPrompt}\n\nRegenerate the presentation incorporating this feedback. Keep the same topic but apply the requested changes.`
      : currentPrompt;

    setSubmittedPrompt(contextPrompt);
    updateMutation.mutate({ prompt: contextPrompt, numSlides, audienceType });

    setTimeout(() => generateMutation.mutate(), 100);
  }

  // Hard signals that the user wants a fresh deck rather than an edit.
  function isNewDeckRequest(text: string): boolean {
    const t = text.toLowerCase().trim();
    return /\b(start over|forget (that|this)|new deck|create (a |an )?(new |different |another )?(deck|presentation)|generate (a |an )?(new |different |another )?(deck|presentation)|switch (the )?topic|different topic|brand[- ]?new)\b/.test(t);
  }

  // Best-effort: pluck slide numbers out of the instruction so the edit
  // agent gets a strong hint. "change slide 3" → [3]; "make slides 2 and 4
  // darker" → [2, 4]. Empty array means: let the agent decide.
  function extractTargetSlideNumbers(text: string): number[] | null {
    const out = new Set<number>();
    const range = /\bslides?\s+(\d+)\s*(?:[-–to]+\s*(\d+))?/gi;
    let m: RegExpExecArray | null;
    while ((m = range.exec(text)) !== null) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        for (let n = lo; n <= hi; n++) out.add(n);
      }
    }
    // Also catch comma-separated forms: "slides 2, 4 and 7"
    const csv = /\bslides?\s+([\d, and]+)/i.exec(text);
    if (csv) {
      for (const tok of csv[1].split(/[,\s]+|\band\b/)) {
        const n = parseInt(tok, 10);
        if (!Number.isNaN(n) && n > 0) out.add(n);
      }
    }
    return out.size === 0 ? null : Array.from(out).sort((a, b) => a - b);
  }

  function handleGenerate() {
    if (!selectedModelId) {
      toast.error("Select an AI model first");
      setActivePanel("model");
      return;
    }
    generateMutation.mutate();
  }

  async function handleApprove() {
    if (!jobId) return;
    try {
      const outlineToSend = editingOutline ? editedOutline : undefined;
      await api.approveJob(jobId, { approved: true, editedOutline: outlineToSend });
      setEditingOutline(false);
      setActivePanel("none");
      toast.success("Outline approved!");
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  async function handleReject() {
    if (!jobId) return;
    try {
      await api.approveJob(jobId, { approved: false, feedback: "User rejected" });
      toast.info("Outline rejected");
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  // Resolve presentation ID from a chat message (tries job output, then latest project presentation)
  async function _resolvePresentationId(msg: { metadata?: Record<string, unknown> }): Promise<string | undefined> {
    try {
      // 1. Direct presentationId stored in the chat message (best — each message maps to its own generation)
      if (msg.metadata?.presentationId) {
        return msg.metadata.presentationId as string;
      }

      // 2. Look up via jobId → job output
      if (msg.metadata?.jobId) {
        const jobData = await api.getJob(msg.metadata.jobId as string) as { output?: { presentationId?: string } };
        if (jobData?.output?.presentationId) return jobData.output.presentationId;
      }

      // 3. Fallback to latest presentation (only if no other option)
      if (p?.presentations?.length) {
        return p.presentations[0]?.id;
      }

      toast.error("No presentation found");
      return undefined;
    } catch { toast.error("Could not find presentation"); return undefined; }
  }

  function openPanel(panel: typeof activePanel) {
    setActivePanel(activePanel === panel ? "none" : panel);
    setShowAttachMenu(false);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex">
        <AppSidebar />
        <div className="flex-1 ml-[72px] flex flex-col items-center justify-center gap-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease }}
            className="flex items-center gap-1.5"
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 rounded-full bg-primary"
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                transition={{ duration: 1, delay: i * 0.15, repeat: Infinity }}
              />
            ))}
          </motion.div>
          <p className="text-sm text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  const engines = [
    { key: "preso-pro" as const, label: "Preso Pro", disabled: false },
    { key: "node-worker" as const, label: "Preso Elite", disabled: false },
    { key: "claude-code" as const, label: "Preso Code", disabled: true },
    { key: "preso-plus" as const, label: "Preso Plus", disabled: false },
  ];

  const attachOptions = [
    { key: "template" as const, icon: Upload, label: "Brand template", desc: "Upload a .pptx to match your theme" },
    { key: "references" as const, icon: FileText, label: "Reference files", desc: "Add documents for AI to research" },
    { key: "model" as const, icon: Brain, label: "AI model", desc: "Choose or add an LLM" },
    { key: "style" as const, icon: Palette, label: "Style profile", desc: "Apply a brand style guide" },
    { key: "engine" as const, icon: Settings2, label: "Engine", desc: "Choose generation engine" },
  ];

  // Chips showing what's attached
  const attachedChips: Array<{ label: string; panel: typeof activePanel }> = [];
  if (p?.template) attachedChips.push({ label: p.template.name, panel: "template" });
  if (p?.referenceFiles?.length) attachedChips.push({ label: `${p.referenceFiles.length} reference${p.referenceFiles.length > 1 ? "s" : ""}`, panel: "references" });
  if (selectedModelId) attachedChips.push({ label: "AI model set", panel: "model" });
  if (selectedProfileId) attachedChips.push({ label: "Style profile", panel: "style" });

  const showPanel = activePanel !== "none";

  // Index of the most recent assistant message with phase=complete. Only that
  // message gets the Download/Preview/Edit action row — older completion
  // messages stay in chat as text history but lose the buttons. Combined with
  // the `isAnyJobActive` gate below, this prevents the duplicate
  // "your slide is ready" rows that appear after follow-up generations.
  let latestCompleteMessageIdx = -1;
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    if (chatMessages[i]?.metadata?.phase === "complete") {
      latestCompleteMessageIdx = i;
      break;
    }
  }
  const isAnyJobActive =
    isGenerating || generateMutation.isPending || editMutation.isPending;

  return (
    <div className="min-h-screen flex">
      <AppSidebar
        showProjectTabs={true}
        activePanel={activePanel}
        onOpenPanel={(panel) => setActivePanel(activePanel === panel ? "none" : panel as typeof activePanel)}
      />

      <div className="flex-1 ml-[72px] flex">
        {/* Chat panel — uses all available space */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="h-11 border-b border-border/60 flex items-center px-5 gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer -mx-1 px-1 py-1 rounded hover:bg-muted/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Projects
            </button>
            <span className="text-muted-foreground/30">/</span>
            <input
              className="bg-transparent border-none outline-none text-sm font-medium flex-1 min-w-0"
              value={projectName || p?.name || ""}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => {
                if (projectName && projectName !== p?.name) {
                  updateMutation.mutate({ name: projectName });
                }
              }}
            />
            <button
              type="button"
              onClick={() => setMemoryOpen(true)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/40"
              title="View what the agent has learned about this project"
            >
              <Brain className="h-3.5 w-3.5" />
              Memory
            </button>
          </div>

          <MemoryDrawer
            projectId={id}
            open={memoryOpen}
            onClose={() => setMemoryOpen(false)}
          />

          {/* Chat area — full width */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-8 space-y-5">
              {/* Empty state when no messages yet */}
              {chatMessages.length === 0 && !hasSubmitted && (
                <div className="flex flex-col items-center justify-center pt-16 text-center">
                  <LottieAnimation
                    src="/animations/creative.json"
                    className="w-52 h-52"
                  />
                  <p className="text-lg font-semibold mt-2">Describe your idea below</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Tell me what your presentation is about and I&apos;ll research, plan, and generate it for you.
                  </p>
                </div>
              )}

              {chatMessages.map((msg, idx) => {
                // "Presentation ready!" messages should appear ONCE — for the
                // most recent completion only. As soon as a fresh job kicks
                // off, hide the previous one entirely (text + buttons) so the
                // chat doesn't accumulate redundant success rows. When the
                // new job completes a new message replaces it.
                const isCompletionMsg =
                  msg.role === "assistant" && msg.metadata?.phase === "complete";
                if (isCompletionMsg && (isAnyJobActive || idx !== latestCompleteMessageIdx)) {
                  return null;
                }
                return (
                <motion.div
                  key={msg.id}
                  initial={idx >= chatMessages.length - 2 ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className={msg.role === "user" ? "flex justify-end" : ""}
                >
                  {msg.role === "user" ? (
                    editingMessageId === msg.id ? (
                      // ── Inline-edit mode ────────────────────────────
                      // Spans the full chat column (escaping the normal
                      // bubble's `max-w-[85%]` constraint) so long prompts
                      // get a proper editor. Save resets the generation
                      // state and resends; the progress sidebar comes up
                      // fresh.
                      <div className="w-full rounded-xl border-2 border-primary/60 bg-primary/[0.04] px-4 py-3">
                        <textarea
                          autoFocus
                          value={editDraft}
                          onChange={(e) => {
                            setEditDraft(e.target.value);
                            const t = e.currentTarget;
                            t.style.height = "auto";
                            t.style.height = Math.min(t.scrollHeight, 480) + "px";
                          }}
                          ref={(el) => {
                            // Initial autogrow on mount.
                            if (el) {
                              el.style.height = "auto";
                              el.style.height = Math.min(el.scrollHeight, 480) + "px";
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingMessageId(null);
                              setEditDraft("");
                            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              (document.querySelector('[data-edit-save]') as HTMLButtonElement | null)?.click();
                            }
                          }}
                          rows={6}
                          className="w-full bg-transparent text-sm leading-relaxed outline-none resize-none border-0 p-0 focus:ring-0 min-h-[120px]"
                          placeholder="Edit your message…"
                        />
                        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-primary/15">
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 min-w-0">
                            <span className="inline-block w-1 h-1 rounded-full bg-primary shrink-0" />
                            <span className="truncate">
                              Saving will resend this prompt and regenerate the deck from scratch.
                            </span>
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMessageId(null);
                                setEditDraft("");
                              }}
                              className="text-xs px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted/40 text-foreground transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              data-edit-save
                              disabled={!editDraft.trim() || editDraft.trim() === msg.content}
                              onClick={() => {
                                const next = editDraft.trim();
                                if (!next || next === msg.content) {
                                  setEditingMessageId(null);
                                  setEditDraft("");
                                  return;
                                }
                                // 1) Rewrite the bubble so the chat shows the
                                //    edited prompt.
                                useChatStore.getState().setMessageContent(id, msg.id, next);
                                setEditingMessageId(null);
                                setEditDraft("");

                                // 2) Wipe the prior generation slot so the
                                //    progress sidebar starts from scratch
                                //    (clears the "Presentation ready" CTA,
                                //    resets the phase indicator, opens the
                                //    plan panel for the new job).
                                useGenerationStore.getState().reset(id);
                                setActivePanel("plan");

                                // 3) Resend. handleSendPrompt routes to
                                //    edit-agent or fresh-generate based on
                                //    whether a deck still exists.
                                setPrompt(next);
                                if (textareaRef.current) {
                                  textareaRef.current.value = next;
                                  textareaRef.current.style.height = "auto";
                                }
                                setTimeout(() => {
                                  const fakeEvt = { preventDefault: () => {} } as React.FormEvent;
                                  handleSendPrompt(fakeEvt);
                                }, 50);
                              }}
                              className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex items-center gap-1.5"
                            >
                              <Send className="h-3 w-3" />
                              Save &amp; resend
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="group/msg flex flex-col items-end max-w-[85%] min-w-0">
                        <>
                          {(() => {
                            // Auto-collapse long prompts so they don't dominate
                            // the chat column when a preview/editor is open
                            // alongside. Threshold ~400 chars (≈6 lines).
                            const LONG_THRESHOLD = 400;
                            const isLong = msg.content.length > LONG_THRESHOLD;
                            const isExpanded = expandedMessages.has(msg.id);
                            const showCollapsed = isLong && !isExpanded;
                            return (
                              <div className="bg-primary/10 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-3 w-full">
                                <div className={showCollapsed ? "relative max-h-[10rem] overflow-hidden" : ""}>
                                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                    {msg.content}
                                  </p>
                                  {showCollapsed && (
                                    <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-primary/10 to-transparent pointer-events-none" />
                                  )}
                                </div>
                                {isLong && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedMessages((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(msg.id)) next.delete(msg.id);
                                        else next.add(msg.id);
                                        return next;
                                      });
                                    }}
                                    className="mt-2 text-[11px] text-primary hover:underline font-medium"
                                  >
                                    {isExpanded ? "Show less" : `Show more · ${msg.content.length.toLocaleString()} chars`}
                                  </button>
                                )}
                                {msg.metadata && (
                                  <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                                    {msg.metadata.audienceType && <span>{msg.metadata.audienceType} audience</span>}
                                    {msg.metadata.numSlides && (
                                      <>
                                        <span className="text-muted-foreground/30">|</span>
                                        <span>{msg.metadata.numSlides} slides</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Hover toolbar — Edit (inline) + Copy. */}
                          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMessageId(msg.id);
                                setEditDraft(msg.content);
                              }}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                              title="Edit message"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(msg.content);
                                  toast.success("Copied");
                                } catch {
                                  toast.error("Couldn't copy");
                                }
                              }}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                              title="Copy"
                            >
                              <CopyIcon className="h-3 w-3" />
                            </button>
                          </div>
                        </>
                      </div>
                    )
                  ) : msg.role === "system" ? (
                    msg.metadata?.phase === "failed" ? (
                      // Structured failure card — actionable buttons based on
                      // the classifier code (Switch model / Add credits / Retry).
                      <JobErrorCard
                        details={msg.metadata?.errorDetails ?? null}
                        rawMessage={msg.metadata?.error ?? msg.content}
                        onSwitchModel={() => setActivePanel("model")}
                        onRetry={() => {
                          // Re-run generation with the current settings.
                          if (selectedModelId && submittedPrompt) {
                            generateMutation.mutate();
                          } else {
                            setActivePanel("model");
                          }
                        }}
                      />
                    ) : (
                      <div className="rounded-lg border border-border/50 bg-muted/30 px-3.5 py-2.5">
                        <p className="text-xs text-muted-foreground">{msg.content}</p>
                      </div>
                    )
                  ) : (
                    <div className="group/msg space-y-1">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      <div className="opacity-0 group-hover/msg:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(msg.content);
                              toast.success("Copied");
                            } catch {
                              toast.error("Couldn't copy");
                            }
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors inline-flex items-center gap-1 text-[11px]"
                          title="Copy"
                        >
                          <CopyIcon className="h-3 w-3" />
                        </button>
                      </div>
                      {msg.metadata?.phase === "complete"
                        && idx === latestCompleteMessageIdx
                        && !isAnyJobActive && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                const presId = await _resolvePresentationId(msg);
                                if (!presId) return;
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
                            <Download className="mr-1 h-3.5 w-3.5" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const presId = await _resolvePresentationId(msg);
                              if (!presId) return;
                              setLatestPresentationId(presId);
                              setActivePanel("preview");
                            }}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const presId = await _resolvePresentationId(msg);
                              if (!presId) return;
                              setLatestPresentationId(presId);
                              setActivePanel("editor");
                            }}
                          >
                            <PenTool className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
                );
              })}

              {/* AI responses */}
              {hasSubmitted && (jobId || generateMutation.isPending) && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className="space-y-4"
                >
                  {/* Phase status */}
                  {phase && phase !== "complete" && phase !== "failed" && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 text-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                        <span className="flex-1">{PHASE_LABELS[phase] || phase}</span>
                        {/* Stop button — only when a job is actively running. */}
                        {jobId && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
                                toast.success("Generation cancelled");
                              } catch (e) {
                                toast.error("Couldn't cancel — " + (e as Error).message);
                              }
                            }}
                            className="text-[11px] px-2 py-1 rounded-md border border-border bg-card hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                            title="Stop this generation"
                          >
                            <Square className="h-3 w-3" />
                            Stop
                          </button>
                        )}
                      </div>
                      <Progress value={progress * 100} />
                      {message && <p className="text-xs text-muted-foreground">{message}</p>}
                    </div>
                  )}

                  {/* Outline review */}
                  {phase === "awaiting_review" && outline.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm">
                        I&apos;ve created an outline for your presentation. Review it and approve to start generating slides.
                      </p>
                      <button
                        onClick={() => openPanel("outline")}
                        className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        View outline
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleApprove}>
                          <Check className="mr-1 h-3.5 w-3.5" />
                          {editingOutline ? "Approve with Edits" : "Approve"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleReject}>
                          <X className="mr-1 h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
                      <p className="text-sm text-destructive">{error}</p>
                      <p className="text-xs text-muted-foreground mt-1">Click Generate again to retry from where it stopped.</p>
                    </div>
                  )}

                  {/*
                    The per-deck completion card now lives inside the chat
                    message list (the `Presentation generated successfully!`
                    bubble with its Download / Preview / Edit actions). We
                    intentionally do NOT render a second "Your presentation
                    is ready!" panel here — it duplicated info, took two
                    scroll-screens of vertical space, and broke the
                    chat-conversation flow. See the chat render block above.
                  */}
                </motion.div>
              )}

              {/* Previous versions */}
              {p?.presentations && p.presentations.length > 0 && !jobId && (
                <div className="pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Previous versions</p>
                  <div className="flex gap-2 flex-wrap">
                    {p.presentations.map((pres) => (
                      <button
                        key={pres.id}
                        onClick={() => router.push(`/presentations/${pres.id}`)}
                        className="text-left rounded-lg border border-border bg-card p-3 hover:border-primary/30 transition-colors"
                      >
                        <p className="text-xs font-medium">{pres.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">v{pres.version} - {pres.slideCount} slides</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Bottom input bar */}
          <div className="border-t border-border/60 px-5 py-3 bg-background">
            <div className="max-w-3xl mx-auto">
              {/* Attached chips row */}
              {attachedChips.length > 0 && (
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {attachedChips.map((c) => (
                    <button
                      key={c.label}
                      onClick={() => openPanel(c.panel)}
                      className="flex items-center gap-1 text-[11px] rounded-md border border-border bg-secondary/50 px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                    >
                      <Paperclip className="h-2.5 w-2.5" />
                      {c.label}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!hasSubmitted) handleSendPrompt(e);
                  else handleSendFollowUp();
                }}
              >
                <div className="rounded-xl border border-border/60 bg-card transition-shadow focus-within:shadow-sm focus-within:border-border">
                  {/* Textarea row */}
                  <div className="flex items-end gap-1.5 px-1.5 pt-1.5">
                    {/* + button */}
                    <div className="relative shrink-0 pb-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowAttachMenu(!showAttachMenu); }}
                        className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                          showAttachMenu ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>

                      <AnimatePresence>
                        {showAttachMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-border bg-popover shadow-xl overflow-hidden z-20"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="p-1.5">
                              {attachOptions.map((opt) => (
                                <button
                                  key={opt.key}
                                  onClick={() => openPanel(opt.key)}
                                  className="w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                                >
                                  <opt.icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-sm font-medium">{opt.label}</p>
                                    <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Pasted image previews */}
                    {pastedImages.length > 0 && (
                      <div className="flex gap-1.5 px-1 pt-1.5 flex-wrap">
                        {pastedImages.map((img, i) => (
                          <div key={img.key} className="relative group">
                            <img src={img.previewUrl} alt={`Pasted ${i + 1}`} className="h-12 w-16 object-cover rounded border border-border" />
                            <button
                              type="button"
                              onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              x
                            </button>
                          </div>
                        ))}
                        {uploadingImage && (
                          <div className="h-12 w-16 rounded border border-dashed border-border flex items-center justify-center">
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Auto-expanding textarea */}
                    <textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => { setPrompt(e.target.value); autoResize(); }}
                      onPaste={handlePasteImage}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (!hasSubmitted) handleSendPrompt(e);
                          else handleSendFollowUp();
                        }
                      }}
                      placeholder={hasSubmitted ? "Ask me to modify the deck, regenerate, or describe changes..." : "Describe your idea or paste images (Ctrl+V)..."}
                      className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/40 min-w-0 py-2 resize-none overflow-hidden leading-relaxed"
                      rows={1}
                      style={{ maxHeight: 200 }}
                      maxLength={5000}
                      onBlur={() => {
                        if (hasSubmitted && prompt !== p?.prompt) updateMutation.mutate({ prompt });
                      }}
                    />
                  </div>

                  {/* Bottom bar with controls */}
                  <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
                    <div className="flex items-center gap-1">
                      <select
                        value={audienceType}
                        onChange={(e) => { setAudienceType(e.target.value); if (hasSubmitted) updateMutation.mutate({ audienceType: e.target.value }); }}
                        className="h-7 rounded-md border border-border bg-secondary/50 px-1.5 text-[11px] focus:outline-none cursor-pointer"
                      >
                        <option value="executive">Executive</option>
                        <option value="technical">Technical</option>
                        <option value="general">General</option>
                        <option value="marketing">Marketing</option>
                      </select>
                      <select
                        value={numSlides}
                        onChange={(e) => { const n = parseInt(e.target.value, 10); setNumSlides(n); if (hasSubmitted) updateMutation.mutate({ numSlides: n }); }}
                        className="h-7 rounded-md border border-border bg-secondary/50 px-1.5 text-[11px] focus:outline-none w-[72px] cursor-pointer"
                      >
                        {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n} slides</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setCreativeMode(!creativeMode)}
                        className={`h-7 rounded-md px-2 text-[11px] transition-colors flex items-center gap-1 ${
                          creativeMode
                            ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30"
                            : "border border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                        }`}
                        title="Creative Mode: advanced visualizations — tables, pyramids, graphs, infographics"
                      >
                        <Sparkles className="h-3 w-3" />
                        Creative
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseDiagramImages(!useDiagramImages)}
                        className={`h-7 rounded-md px-2 text-[11px] transition-colors flex items-center gap-1 ${
                          useDiagramImages
                            ? "bg-violet-500/15 text-violet-500 ring-1 ring-violet-500/30"
                            : "border border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                        }`}
                        title="Diagram Images: renders complex diagrams via Kroki as high-quality images"
                      >
                        <BarChart3 className="h-3 w-3" />
                        Diagrams
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {prompt.length > 4500 && (
                        <span className={`text-[11px] tabular-nums ${prompt.length >= 5000 ? "text-destructive" : "text-muted-foreground"}`}>
                          {prompt.length}/5000
                        </span>
                      )}
                      <button
                        type="submit"
                        disabled={!prompt.trim() || (hasSubmitted && (!selectedModelId || isGenerating)) || generateMutation.isPending}
                        className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
                      >
                        {(generateMutation.isPending || isGenerating) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: (activePanel === "preview" || activePanel === "editor") ? "65vw" : 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="border-l border-border/60 bg-card overflow-hidden shrink-0 relative"
              style={{ minWidth: (activePanel === "preview" || activePanel === "editor") ? 700 : 380, maxWidth: (activePanel === "preview" || activePanel === "editor") ? "80vw" : 420 }}
            >
              <div className="w-full h-full flex flex-col">
                {/* Panel header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0 gap-3">
                  <p className="text-sm font-semibold shrink-0">
                    {activePanel === "plan" && "Slide Plan"}
                    {activePanel === "preview" && "Presentation Preview"}
                    {activePanel === "files" && "Generated Files"}
                    {activePanel === "editor" && "Collabora Editor"}
                    {activePanel === "outline" && "Outline"}
                    {activePanel === "template" && "Brand Template"}
                    {activePanel === "references" && "Reference Files"}
                    {activePanel === "model" && "AI Model"}
                    {activePanel === "style" && "Style Profile"}
                    {activePanel === "engine" && "Engine"}
                  </p>

                  {/* Version switcher — only when previewing/editing AND there
                      is at least one rendered presentation. Drives both the
                      preview and the editor; download buttons inside the
                      panel use the selected version too. */}
                  {(activePanel === "preview" || activePanel === "editor")
                    && p?.presentations && p.presentations.length > 0 && (
                    <select
                      value={latestPresentationId || p.presentations[0]!.id}
                      onChange={(e) => setLatestPresentationId(e.target.value)}
                      className="ml-auto h-7 max-w-[180px] rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
                      aria-label="Select version"
                    >
                      {p.presentations.map((pres) => (
                        <option key={pres.id} value={pres.id}>
                          v{pres.version} · {pres.slideCount} slide{pres.slideCount !== 1 ? "s" : ""}
                          {pres === p.presentations[0] ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                  )}

                  <div className="flex items-center gap-1 shrink-0">
                    {activePanel === "outline" && phase === "awaiting_review" && (
                      <button
                        onClick={() => setEditingOutline(!editingOutline)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => setActivePanel("none")}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Panel body */}
                <div className="flex-1 overflow-y-auto">
                  {/* Slide Plan — live generation view */}
                  {activePanel === "plan" && (
                    <SlidePlanPanel
                      outline={outline}
                      phase={phase}
                      progress={progress}
                      message={message}
                    />
                  )}

                  {/* PPTX Preview — rendered slides */}
                  {activePanel === "preview" && (latestPresentationId || p?.presentations?.[0]) && (
                    <PptxPreview
                      presentationId={latestPresentationId || p!.presentations[0].id}
                      projectId={id}
                      onOpenEditor={() => setActivePanel("editor")}
                    />
                  )}

                  {/* Files — all generated presentations */}
                  {activePanel === "files" && (
                    <div className="p-5 space-y-3">
                      <p className="text-xs text-muted-foreground">All presentations generated in this project.</p>
                      {p?.presentations && p.presentations.length > 0 ? (
                        p.presentations.map((pres) => (
                          <div key={pres.id} className="rounded-lg border border-border bg-background p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium truncate">{pres.title || "Presentation"}</p>
                              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">v{pres.version}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{pres.slideCount} slide{pres.slideCount !== 1 ? "s" : ""}</p>
                            <div className="flex gap-1.5">
                              <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                                onClick={() => {
                                  // Switch to preview for this specific presentation
                                  // Force reload by updating query
                                  queryClient.invalidateQueries({ queryKey: ["project", id] });
                                  setActivePanel("preview");
                                }}
                              >
                                Preview
                              </Button>
                              <Button size="sm" variant="outline" className="flex-1 text-xs h-7"
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`/api/presentations/${pres.id}/download`);
                                    if (!res.ok) throw new Error("Download failed");
                                    const { downloadUrl, fileName } = await res.json();
                                    const a = document.createElement("a");
                                    a.href = downloadUrl;
                                    a.download = fileName || "presentation.pptx";
                                    a.click();
                                  } catch (err) { toast.error((err as Error).message); }
                                }}
                              >
                                <Download className="mr-1 h-3 w-3" />
                                Download
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-8">No presentations yet. Generate one first.</p>
                      )}
                    </div>
                  )}

                  {/* Editor — Collabora inline. Uses the version selected in
                      the panel header dropdown (defaults to the latest). */}
                  {activePanel === "editor" && p?.presentations?.[0] && (
                    <CollaboraEditor
                      presentationId={latestPresentationId || p.presentations[0].id}
                      // Force a remount when the version changes so Collabora
                      // re-fetches the new file rather than holding the old
                      // document in its iframe state.
                      key={latestPresentationId || p.presentations[0].id}
                    />
                  )}

                  <div className={activePanel === "plan" || activePanel === "preview" || activePanel === "files" || activePanel === "editor" ? "hidden" : "p-5"}>
                  {/* Outline */}
                  {activePanel === "outline" && phase === "awaiting_review" && outline.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">Key ideas (not final wording)</p>
                      {(editingOutline ? editedOutline : outline).map((item, i) => (
                        <div key={i} className="rounded-lg border border-border bg-background p-3">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            {editingOutline ? (
                              <input
                                className="flex-1 bg-transparent border-b border-primary/30 text-sm font-medium focus:outline-none focus:border-primary/50 pb-0.5"
                                value={editedOutline[i]?.title || ""}
                                onChange={(e) => {
                                  const updated = [...editedOutline];
                                  if (updated[i]) { updated[i] = { ...updated[i], title: e.target.value }; setEditedOutline(updated); }
                                }}
                              />
                            ) : (
                              <p className="text-sm font-medium">{item.title}</p>
                            )}
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.layout}</Badge>
                          </div>
                          <ul className="space-y-0.5">
                            {item.key_points.map((point, j) => (
                              <li key={j} className="text-xs text-muted-foreground">- {point}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Template panel */}
                  {activePanel === "template" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">Upload a .pptx file to use its theme, colors, and fonts in your generated presentation.</p>
                      <FileUpload
                        projectId={id}
                        purpose="template"
                        accept={{ "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"] }}
                        onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
                      />
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <div className="flex-1 h-px bg-border/40" />
                        <span>or</span>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                      <FilePicker
                        allowedKinds={["pptx"]}
                        buttonLabel="Choose from your uploads"
                        onPick={async (item) => {
                          const r = await fetch(`/api/projects/${id}/template`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ s3Key: item.s3Key }),
                          });
                          if (!r.ok) {
                            toast.error("Failed to attach template");
                            return;
                          }
                          toast.success(`Using ${item.fileName} as template`);
                          queryClient.invalidateQueries({ queryKey: ["project", id] });
                        }}
                      />
                      {p?.template && (
                        <div className="space-y-2 border border-border rounded-lg p-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">{p.template.name}</span>
                            <button onClick={() => deleteTemplateMutation.mutate(p.template!.id)} className="text-destructive hover:underline">Remove</button>
                          </div>
                          {p.template.themeConfig ? (
                            <ThemePreview themeConfig={p.template.themeConfig as { colors?: Record<string, string>; heading_font?: string; body_font?: string }} />
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {/* References panel */}
                  {activePanel === "references" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">Add documents the AI will use as research material for your presentation.</p>
                      <FileUpload
                        projectId={id}
                        purpose="reference"
                        onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ["project", id] })}
                      />
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        <div className="flex-1 h-px bg-border/40" />
                        <span>or</span>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                      <FilePicker
                        buttonLabel="Choose from your uploads"
                        onPick={async (item) => {
                          const r = await fetch(`/api/projects/${id}/references`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              s3Key: item.s3Key,
                              fileName: item.fileName,
                              fileType: item.mimeType || item.fileName.split(".").pop() || "",
                              fileSize: item.fileSize || 1,
                            }),
                          });
                          if (!r.ok) {
                            toast.error("Failed to attach reference");
                            return;
                          }
                          toast.success(`Added ${item.fileName} as reference`);
                          queryClient.invalidateQueries({ queryKey: ["project", id] });
                        }}
                      />
                      <div className="space-y-1.5">
                        {p?.referenceFiles?.map((f) => (
                          <FileListItem key={f.id} fileName={f.fileName} status={f.extractionStatus} fileSize={f.fileSize} onDelete={() => deleteRefMutation.mutate(f.id)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Model panel */}
                  {activePanel === "model" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">Select or add the AI model that will generate your slides.</p>
                      <LLMSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} />
                    </div>
                  )}

                  {/* Style Profile panel */}
                  {activePanel === "style" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">Apply a style profile built from analyzing your existing presentations.</p>
                      <StyleProfileSelector
                        selectedProfileId={selectedProfileId}
                        onProfileChange={(profileId) => {
                          setSelectedProfileId(profileId);
                          updateMutation.mutate({ styleProfileId: profileId || null });
                        }}
                        selectedModelId={selectedModelId}
                      />
                      <StyleProfileViewer profileId={selectedProfileId} />
                    </div>
                  )}

                  {/* Engine panel */}
                  {activePanel === "engine" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">Choose how your presentation is generated.</p>
                      <div className="space-y-2">
                        {engines.map((eng) => (
                          <button
                            key={eng.key}
                            onClick={() => !eng.disabled && setEngine(eng.key)}
                            disabled={eng.disabled}
                            className={`w-full text-left rounded-lg border p-3 transition-colors ${
                              eng.disabled
                                ? "border-border/50 opacity-50 cursor-not-allowed"
                                : engine === eng.key
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:border-primary/30"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{eng.label}</p>
                              {eng.disabled && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Coming soon</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {eng.key === "preso-pro" && "Marketing-grade decks. Locked palettes, shape kit, native editable PPTX."}
                              {eng.key === "node-worker" && "AI-powered slide generation with visual design"}
                              {eng.key === "claude-code" && "Advanced AI code generation engine"}
                              {eng.key === "preso-plus" && "Claude Code routed through an open-source Anthropic→Gemini proxy. No Anthropic key required."}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
