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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileUpload, FileListItem } from "@/components/project/file-upload";
import { ThemePreview } from "@/components/project/theme-preview";
import { LLMSelector } from "@/components/project/llm-selector";
import { StyleProfileSelector } from "@/components/project/style-profile-selector";
import { StyleProfileViewer } from "@/components/project/style-profile-viewer";
import { useGenerationStore } from "@/lib/stores/generation-store";
import { useChatStore, type ChatMessage } from "@/lib/stores/chat-store";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { LottieAnimation } from "@/components/lottie-animation";
import { SlidePlanPanel } from "@/components/generation/slide-plan-panel";
import { PptxPreview } from "@/components/generation/pptx-preview";
import { CollaboraEditor } from "@/components/generation/collabora-editor";
import { api } from "@/lib/api-client";

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
    updateProgress,
  } = useGenerationStore();

  const addMessage = useChatStore((s) => s.addMessage);
  const getMessages = useChatStore((s) => s.getMessages);
  const updateLastAssistantMessage = useChatStore((s) => s.updateLastAssistantMessage);
  const chatMessages = useChatStore((s) => s.chats[id]?.messages) || EMPTY_MESSAGES;

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length]);

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

    if (phase === "complete") {
      savedPhasesRef.current.add(key);
      addMessage(id, {
        role: "assistant",
        content: "Presentation generated successfully! You can download it now.",
        metadata: { phase: "complete", jobId },
      });
      setActivePanel("preview");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    } else if (phase === "failed" && error) {
      savedPhasesRef.current.add(key);
      addMessage(id, {
        role: "system",
        content: `Generation failed: ${error}`,
        metadata: { phase: "failed", jobId, error },
      });
    }
  }, [phase, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [prompt, setPrompt] = useState("");
  const [numSlides, setNumSlides] = useState(10);
  const [audienceType, setAudienceType] = useState("general");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [engine, setEngine] = useState<"claude-code" | "claude-gemini" | "node-worker">("node-worker");
  const [creativeMode, setCreativeMode] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pastedImages, setPastedImages] = useState<Array<{ key: string; previewUrl: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [activePanel, setActivePanel] = useState<"none" | "outline" | "plan" | "preview" | "files" | "editor" | "template" | "references" | "model" | "style" | "engine">("none");
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
              content: "Presentation generated successfully! You can download it now.",
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

      // Read creativeMode from URL (always, even if auto-generate doesn't fire)
      if (searchParams.get("creativeMode") === "1") setCreativeMode(true);

      // Auto-generate if coming from dashboard
      if (shouldAutoGenerate && p.prompt && modelFromUrl && !autoGenerateHandled) {
        setSelectedModelId(modelFromUrl);
        const engineFromUrl = searchParams.get("engine") as typeof engine | null;
        if (engineFromUrl) setEngine(engineFromUrl);
        setAutoGenerateHandled(true);
        setPrompt("");
        router.replace(`/projects/${id}`, { scroll: false });
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
        chatImageKeys: chatMessages
          .filter((m) => m.metadata?.imageKeys)
          .flatMap((m) => (m.metadata!.imageKeys as string[]) || []),
      }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setActivePanel("plan");
      addMessage(id, {
        role: "assistant",
        content: `Starting presentation generation using ${engine === "claude-gemini" ? "Preso Plus" : engine === "claude-code" ? "Preso Pro" : "Preso Elite"} engine${creativeMode ? " with Creative Mode" : ""}...`,
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

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    if (!selectedModelId) {
      toast.error("Please select an AI model first (click + button)");
      return;
    }

    const currentPrompt = prompt.trim();

    // Save to chat history
    const imageKeys = pastedImages.map((img) => img.key);
    addMessage(id, {
      role: "user",
      content: currentPrompt,
      metadata: { audienceType, numSlides, engine, imageKeys: imageKeys.length > 0 ? imageKeys : undefined },
    });

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

  function handleSendFollowUp() {
    if (!prompt.trim()) return;

    const currentPrompt = prompt.trim();

    // Save follow-up as user message
    addMessage(id, {
      role: "user",
      content: currentPrompt,
      metadata: { audienceType, numSlides },
    });

    // Build context-aware prompt: include the original topic + follow-up instruction
    // so the LLM knows what deck was previously generated and what to change
    const originalPrompt = p?.prompt || submittedPrompt || "";
    const contextPrompt = originalPrompt
      ? `[FOLLOW-UP] Original deck topic: "${originalPrompt}"\n\nUser's modification request: ${currentPrompt}\n\nRegenerate the presentation incorporating this feedback. Keep the same topic but apply the requested changes.`
      : currentPrompt;

    setSubmittedPrompt(contextPrompt);
    updateMutation.mutate({ prompt: contextPrompt, numSlides, audienceType });

    // Clear the input
    setPrompt("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }

    // Auto-generate if model is selected
    if (selectedModelId) {
      setTimeout(() => generateMutation.mutate(), 100);
    } else {
      toast.error("Select an AI model first");
      setActivePanel("model");
    }
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
      let presId: string | undefined;
      if (msg.metadata?.jobId) {
        const jobData = await api.getJob(msg.metadata.jobId as string) as { output?: { presentationId?: string } };
        presId = jobData?.output?.presentationId;
      }
      if (!presId && p?.presentations?.length) {
        presId = p.presentations[0]?.id;
      }
      if (!presId) { toast.error("No presentation found"); return undefined; }
      return presId;
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
    { key: "claude-code" as const, label: "Preso Pro", disabled: true },
    { key: "claude-gemini" as const, label: "Preso Plus", disabled: true },
    { key: "node-worker" as const, label: "Preso Elite", disabled: false },
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
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
          </div>

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

              {/* Persistent chat messages */}
              {chatMessages.map((msg, idx) => (
                <motion.div
                  key={msg.id}
                  initial={idx >= chatMessages.length - 2 ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease }}
                  className={msg.role === "user" ? "flex justify-end" : ""}
                >
                  {msg.role === "user" ? (
                    <div className="bg-primary/10 border border-primary/15 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[85%]">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
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
                  ) : msg.role === "system" ? (
                    <div className="rounded-lg border border-border/50 bg-muted/30 px-3.5 py-2.5">
                      <p className="text-xs text-muted-foreground">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                      {msg.metadata?.phase === "complete" && (
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
              ))}

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
                        <span>{PHASE_LABELS[phase] || phase}</span>
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

                  {/* Complete */}
                  {phase === "complete" && (
                    <div className="space-y-4">
                      <div className="flex items-start gap-3">
                        <LottieAnimation
                          src="/animations/success-check.json"
                          className="w-12 h-12 -mt-1 shrink-0"
                          loop={false}
                        />
                        <p className="text-sm font-medium pt-2">Your presentation is ready!</p>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2">
                        {Array.from({ length: Math.min(numSlides, 8) }).map((_, i) => (
                          <div key={i} className="shrink-0 w-56 aspect-[16/9] rounded-lg border border-border bg-muted/50 flex items-center justify-center text-xs text-muted-foreground">
                            Slide {i + 1}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button size="sm" onClick={async () => {
                          try {
                            const jobData = await api.getJob(jobId!) as { output?: { presentationId?: string } };
                            const presId = jobData?.output?.presentationId;
                            if (!presId) { toast.error("Not found yet"); return; }
                            const res = await fetch(`/api/presentations/${presId}/download`);
                            if (!res.ok) throw new Error("Download failed");
                            const { downloadUrl, fileName } = await res.json();
                            const a = document.createElement("a");
                            a.href = downloadUrl;
                            a.download = fileName || "presentation.pptx";
                            a.click();
                          } catch (err) { toast.error((err as Error).message); }
                        }}>
                          <Download className="mr-1.5 h-3.5 w-3.5" /> Download PPTX
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => toast.info("Connect Microsoft account")}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> PowerPoint
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => toast.info("Connect Canva account")}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Canva
                        </Button>
                      </div>
                    </div>
                  )}
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
                    </div>
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
                <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 shrink-0">
                  <p className="text-sm font-semibold">
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
                  <div className="flex items-center gap-1">
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
                  {activePanel === "preview" && p?.presentations?.[0] && (
                    <PptxPreview
                      presentationId={p.presentations[0].id}
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

                  {/* Editor — Collabora inline */}
                  {activePanel === "editor" && p?.presentations?.[0] && (
                    <CollaboraEditor presentationId={p.presentations[0].id} />
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
                              {eng.key === "claude-code" && "Advanced AI code generation engine"}
                              {eng.key === "claude-gemini" && "Gemini-powered design engine"}
                              {eng.key === "node-worker" && "AI-powered slide generation with visual design"}
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
