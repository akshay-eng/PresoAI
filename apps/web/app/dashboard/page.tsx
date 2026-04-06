"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Search, FileText, Trash2, Clock, Send, Presentation, X,
  BarChart3, Users, Lightbulb, Upload, Palette, Brain, Settings2, Loader2, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { GlobalPanels } from "@/components/global-panels";
import { LottieAnimation } from "@/components/lottie-animation";
import { api } from "@/lib/api-client";
import { StyleProfileViewer } from "@/components/project/style-profile-viewer";

const ease = [0.22, 1, 0.36, 1] as const;

export default function DashboardPage() {
  const [sidebarPanel, setSidebarPanel] = useState("");
  const router = useRouter();
  const { data: session } = useSession({ required: true });
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [quickPrompt, setQuickPrompt] = useState("");
  const [audienceType, setAudienceType] = useState("general");
  const [numSlides, setNumSlides] = useState(10);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [engine, setEngine] = useState<"claude-code" | "claude-gemini" | "node-worker">("node-worker");
  const [showAttach, setShowAttach] = useState(false);
  const [showCreateStyle, setShowCreateStyle] = useState(false);
  const [showStyleDetail, setShowStyleDetail] = useState<string | null>(null);
  const [newStyleName, setNewStyleName] = useState("");
  const [styleFiles, setStyleFiles] = useState<File[]>([]);
  const [creatingStyle, setCreatingStyle] = useState(false);
  const [deleteStyleConfirm, setDeleteStyleConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deletingStyle, setDeletingStyle] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load models for the selector
  const { data: models } = useQuery({
    queryKey: ["llm-models"],
    queryFn: () => api.listModels(),
  });

  const modelsData = models as { models?: unknown[] } | unknown[] | undefined;
  const modelList = (Array.isArray(modelsData) ? modelsData : (modelsData?.models || [])) as Array<{
    id: string; name: string; provider: string; isDefault: boolean;
  }>;

  // Load style profiles
  const { data: styleProfiles = [] } = useQuery({
    queryKey: ["style-profiles"],
    queryFn: async () => {
      const r = await fetch("/api/style-profiles");
      if (!r.ok) return [];
      return r.json() as Promise<Array<{ id: string; name: string; status: string }>>;
    },
  });
  const readyProfiles = (styleProfiles as Array<{ id: string; name: string; status: string }>).filter((p) => p.status === "ready");
  const [selectedProfileId, setSelectedProfileId] = useState("");

  // Auto-select default model
  useEffect(() => {
    if (!selectedModelId && modelList.length > 0) {
      const def = modelList.find((m) => m.isDefault) || modelList[0];
      if (def) setSelectedModelId(def.id);
    }
  }, [modelList, selectedModelId]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  const { data, isLoading } = useQuery({
    queryKey: ["projects", search],
    queryFn: () => api.listProjects(undefined, search || undefined),
    enabled: !!session,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const prompt = quickPrompt.trim();
      // Create the project with all settings
      const project = await api.createProject({
        name: prompt.slice(0, 60),
        prompt,
        numSlides,
        audienceType,
      });
      return project;
    },
    onSuccess: (project: unknown) => {
      const p = project as { id: string };
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Pass settings via URL params so project page can auto-trigger generation
      const params = new URLSearchParams({
        autoGenerate: "1",
        modelId: selectedModelId,
        engine,
      });
      router.push(`/projects/${p.id}?${params.toString()}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeleteConfirm(null);
      toast.success("Project deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const projects = (data?.items || []) as Array<{
    id: string;
    name: string;
    prompt: string;
    audienceType: string;
    createdAt: string;
    template?: { name: string };
    _count: { presentations: number; referenceFiles: number };
  }>;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    if (!selectedModelId) {
      toast.error("Select an AI model first");
      setShowAttach(true);
      return;
    }
    createMutation.mutate();
  }

  // Close popover on outside click
  useEffect(() => {
    if (!showAttach) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-attach-popover]")) setShowAttach(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showAttach]);

  const selectedModel = modelList.find((m) => m.id === selectedModelId);

  return (
    <div className="min-h-screen flex relative">
      <AppSidebar
        activePanel={sidebarPanel}
        onOpenPanel={(p) => setSidebarPanel(sidebarPanel === p ? "" : p)}
      />
      <GlobalPanels activePanel={sidebarPanel} onClose={() => setSidebarPanel("")} />

      {/* Full-page transition overlay when creating */}
      <AnimatePresence>
        {createMutation.isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
          >
            <motion.div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                  transition={{ duration: 1, delay: i * 0.15, repeat: Infinity }}
                />
              ))}
            </motion.div>
            <p className="text-sm text-muted-foreground">Creating your project...</p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 ml-[72px]">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="max-w-2xl mx-auto pt-16 pb-12 px-6 text-center"
        >
          <LottieAnimation src="/animations/presentation.json" className="w-36 h-36 mx-auto -mb-2" />
          <h1 className="text-3xl font-bold tracking-tight">What will you present today?</h1>

          <form onSubmit={handleSubmit} className="mt-8 relative">
            <div className="rounded-xl border border-border/60 bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:border-border">
              {/* Textarea row */}
              <div className="flex items-end gap-1.5 px-2 pt-2">
                {/* + attach button */}
                <div className="relative pb-1" data-attach-popover>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowAttach(!showAttach); }}
                    className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                      showAttach ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>

                  {/* Attach popover */}
                  <AnimatePresence>
                    {showAttach && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 mt-2 w-72 rounded-xl border border-border bg-popover shadow-xl z-30"
                        data-attach-popover
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-3 space-y-3">
                          <p className="text-xs font-semibold text-muted-foreground">Configure</p>

                          {/* Model selector */}
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                              <Brain className="h-3 w-3" /> AI Model
                            </label>
                            <select
                              value={selectedModelId}
                              onChange={(e) => setSelectedModelId(e.target.value)}
                              className="w-full h-8 rounded-lg border border-border bg-secondary/50 px-2 text-xs focus:outline-none"
                            >
                              <option value="">Select a model...</option>
                              {modelList.map((m) => (
                                <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                              ))}
                            </select>
                          </div>

                          {/* Audience */}
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                              <Users className="h-3 w-3" /> Audience
                            </label>
                            <div className="flex gap-1">
                              {(["executive", "technical", "general"] as const).map((a) => (
                                <button
                                  key={a}
                                  type="button"
                                  onClick={() => setAudienceType(a)}
                                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                                    audienceType === a
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {a.charAt(0).toUpperCase() + a.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Slide count */}
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                              <Presentation className="h-3 w-3" /> Slides: {numSlides}
                            </label>
                            <input
                              type="range"
                              min={1}
                              max={15}
                              value={numSlides}
                              onChange={(e) => setNumSlides(parseInt(e.target.value, 10))}
                              className="w-full h-1.5 bg-secondary rounded-full appearance-none accent-primary"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-0.5">
                              <span>1</span><span>15</span>
                            </div>
                          </div>

                          {/* Engine */}
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                              <Settings2 className="h-3 w-3" /> Engine
                            </label>
                            <div className="flex gap-1">
                              {([
                                { key: "claude-code" as const, label: "Preso Pro", disabled: true },
                                { key: "claude-gemini" as const, label: "Preso Plus", disabled: true },
                                { key: "node-worker" as const, label: "Preso Elite", disabled: false },
                              ]).map((eng) => (
                                <button
                                  key={eng.key}
                                  type="button"
                                  onClick={() => !eng.disabled && setEngine(eng.key)}
                                  disabled={eng.disabled}
                                  className={`flex-1 rounded-md py-1.5 text-[10px] font-medium transition-colors relative ${
                                    eng.disabled
                                      ? "bg-secondary/30 text-muted-foreground/40 cursor-not-allowed"
                                      : engine === eng.key
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-secondary/50 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {eng.label}
                                  {eng.disabled && <span className="absolute -top-1.5 right-0.5 text-[7px] bg-muted text-muted-foreground px-1 rounded">Soon</span>}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Style Profile */}
                          {readyProfiles.length > 0 && (
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
                                <Sparkles className="h-3 w-3" /> Style Profile
                              </label>
                              <select
                                value={selectedProfileId}
                                onChange={(e) => setSelectedProfileId(e.target.value)}
                                className="w-full h-8 rounded-lg border border-border bg-secondary/50 px-2 text-xs focus:outline-none"
                              >
                                <option value="">No style profile</option>
                                {readyProfiles.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          <p className="text-[10px] text-muted-foreground/50 pt-1">
                            Templates and references can be added inside the project.
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <textarea
                  ref={textareaRef}
                  value={quickPrompt}
                  onChange={(e) => { setQuickPrompt(e.target.value); autoResize(); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder="Describe your presentation idea..."
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground/50 py-2 resize-none overflow-hidden leading-relaxed"
                  rows={1}
                  style={{ maxHeight: 200 }}
                />
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
                {/* Active config chips */}
                <div className="flex items-center gap-1 flex-wrap">
                  {selectedModel && (
                    <span
                      className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 cursor-pointer hover:bg-primary/15 transition-colors"
                      onClick={() => setShowAttach(true)}
                    >
                      {selectedModel.name}
                    </span>
                  )}
                  <span
                    className="text-[10px] rounded-md bg-secondary px-1.5 py-0.5 text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => setShowAttach(true)}
                  >
                    {audienceType} / {numSlides} slides
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={!quickPrompt.trim() || createMutation.isPending}
                  className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Suggestions */}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {[
              { icon: Presentation, label: "Sales pitch deck", prompt: "Create a 10-slide sales pitch deck for a B2B SaaS product" },
              { icon: BarChart3, label: "Quarterly review", prompt: "Quarterly business review presentation with KPIs and metrics" },
              { icon: Users, label: "Team onboarding", prompt: "New hire onboarding presentation covering company culture and processes" },
              { icon: Lightbulb, label: "Product roadmap", prompt: "Product roadmap presentation for stakeholders with timeline and milestones" },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => { setQuickPrompt(s.prompt); textareaRef.current?.focus(); }}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
              >
                <s.icon className="h-3 w-3" />
                {s.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Brand & Style Profiles */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4, ease }}
          className="max-w-5xl mx-auto px-6 pb-8"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold">Brand Styles</h2>
              <p className="text-xs text-muted-foreground">Upload .pptx files to create a reusable style profile</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setShowCreateStyle(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              New Style
            </Button>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {/* Create new style card */}
            <button
              onClick={() => setShowCreateStyle(true)}
              className="shrink-0 w-48 h-32 rounded-xl border border-dashed border-border/60 flex flex-col items-center justify-center gap-2 text-muted-foreground/50 hover:text-foreground hover:border-border hover:bg-muted/20 transition-all"
            >
              <Upload className="h-5 w-5" />
              <span className="text-xs font-medium">Upload & Analyze</span>
            </button>

            {/* Existing profiles */}
            {(styleProfiles as Array<{ id: string; name: string; status: string; visualStyle?: { design_language?: string }; themeConfig?: Record<string, string> }>).map((profile) => (
              <div
                key={profile.id}
                onClick={() => {
                  setSelectedProfileId(profile.id);
                  setShowStyleDetail(profile.id);
                }}
                className={`shrink-0 w-48 h-36 rounded-xl border transition-all cursor-pointer overflow-hidden relative group flex flex-col ${
                  selectedProfileId === profile.id
                    ? "border-primary ring-1 ring-primary/30"
                    : "border-border/60 hover:border-border hover:shadow-sm"
                }`}
              >
                {/* Color bar from theme */}
                <div className="h-2 w-full flex">
                  {profile.themeConfig && Object.entries(profile.themeConfig)
                    .filter(([k]) => k.startsWith("accent"))
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k} className="flex-1" style={{ backgroundColor: v as string }} />
                    ))
                  }
                  {(!profile.themeConfig || Object.keys(profile.themeConfig).length === 0) && (
                    <div className="flex-1 bg-gradient-to-r from-primary/30 to-primary/10" />
                  )}
                </div>
                <div className="p-2.5 flex-1 flex flex-col">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold truncate">{profile.name}</p>
                    <Badge variant={profile.status === "ready" ? "default" : "secondary"} className="text-[8px] h-4 px-1">
                      {profile.status}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-tight flex-1">
                    {(profile.visualStyle as { design_language?: string })?.design_language || "Analyzing style..."}
                  </p>
                  <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/30">
                    <span className="text-[9px] text-muted-foreground/50">Click to view</span>
                    <button
                      className="p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteStyleConfirm({ id: profile.id, name: profile.name });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Style Detail Modal */}
        <AnimatePresence>
          {showStyleDetail && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
              onClick={() => setShowStyleDetail(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-card rounded-2xl border border-border shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Style Profile Details</h3>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        const prof = (styleProfiles as Array<{ id: string; name: string }>).find((p) => p.id === showStyleDetail);
                        setDeleteStyleConfirm({ id: showStyleDetail!, name: prof?.name || "Style" });
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setShowStyleDetail(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <StyleProfileViewer profileId={showStyleDetail} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create Style Modal */}
        <AnimatePresence>
          {showCreateStyle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
              onClick={() => setShowCreateStyle(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-card rounded-2xl border border-border shadow-2xl max-w-md w-full p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-sm font-semibold mb-3">Create Style Profile</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Upload .pptx files and we&apos;ll analyze the visual style, colors, fonts, and layouts to create a reusable brand profile.
                </p>

                <div className="space-y-3">
                  <Input
                    placeholder="Style name (e.g. Company Brand)"
                    value={newStyleName}
                    onChange={(e) => setNewStyleName(e.target.value)}
                    className="text-xs h-8"
                  />

                  <div
                    className="border-2 border-dashed border-border/60 rounded-xl p-6 text-center cursor-pointer hover:border-border hover:bg-muted/10 transition-colors"
                    onClick={() => document.getElementById("style-file-input")?.click()}
                  >
                    <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground/50" />
                    <p className="text-xs font-medium">Drop .pptx files here or click to browse</p>
                    <p className="text-[10px] text-muted-foreground mt-1">We&apos;ll sample 3-4 slides per file for visual analysis</p>
                    <input
                      id="style-file-input"
                      type="file"
                      accept=".pptx"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length === 0) return;
                        setStyleFiles(files);
                      }}
                    />
                  </div>

                  {styleFiles.length > 0 && (
                    <div className="space-y-1">
                      {styleFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f.name}</span>
                          <span className="text-[10px]">{(f.size / 1024).toFixed(0)}KB</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm"
                    className="w-full h-8 text-xs"
                    disabled={!newStyleName.trim() || styleFiles.length === 0 || creatingStyle}
                    onClick={async () => {
                      setCreatingStyle(true);
                      try {
                        // 1. Create the profile
                        const createRes = await fetch("/api/style-profiles", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newStyleName }),
                        });
                        if (!createRes.ok) throw new Error("Failed to create profile");
                        const { id: profileId } = await createRes.json();

                        // 2. Upload each file
                        for (const file of styleFiles) {
                          const presignRes = await fetch("/api/upload/presign", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation", purpose: "template" }),
                          });
                          if (!presignRes.ok) continue;
                          const { signedUrl, key } = await presignRes.json();
                          await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });

                          // Add source file
                          await fetch(`/api/style-profiles/${profileId}/sources`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ s3Key: key, fileName: file.name, fileSize: file.size }),
                          });
                        }

                        // 3. Analyze (needs a modelId — pick default or first available)
                        const analyzeModelId =
                          modelList.find((m) => m.isDefault)?.id || modelList[0]?.id;
                        if (!analyzeModelId) {
                          throw new Error("No LLM model configured. Add one in Settings first.");
                        }
                        await fetch(`/api/style-profiles/${profileId}/analyze`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ modelId: analyzeModelId }),
                        });

                        toast.success("Style profile created! Analyzing...");
                        setShowCreateStyle(false);
                        setNewStyleName("");
                        setStyleFiles([]);
                        queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
                      } catch (err) {
                        toast.error((err as Error).message);
                      }
                      setCreatingStyle(false);
                    }}
                  >
                    {creatingStyle ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Create & Analyze
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Style Confirmation Modal */}
        <AnimatePresence>
          {deleteStyleConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-6"
              onClick={() => setDeleteStyleConfirm(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-card rounded-2xl border border-border shadow-2xl max-w-sm w-full p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Delete style profile</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Are you sure you want to delete <span className="font-medium text-foreground">&quot;{deleteStyleConfirm.name}&quot;</span>? This action cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDeleteStyleConfirm(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8 text-xs"
                    disabled={deletingStyle}
                    onClick={async () => {
                      setDeletingStyle(true);
                      try {
                        await fetch(`/api/style-profiles/${deleteStyleConfirm.id}`, { method: "DELETE" });
                        toast.success("Style profile deleted");
                        if (selectedProfileId === deleteStyleConfirm.id) setSelectedProfileId("");
                        if (showStyleDetail === deleteStyleConfirm.id) setShowStyleDetail(null);
                        queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
                        setDeleteStyleConfirm(null);
                      } catch { toast.error("Failed to delete"); }
                      setDeletingStyle(false);
                    }}
                  >
                    {deletingStyle ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Delete
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent projects */}
        <div className="max-w-5xl mx-auto px-6 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.4, ease }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold">Recent projects</h2>
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search..." className="pl-8 h-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-16">
                <LottieAnimation src="/animations/empty-state.json" className="w-48 h-48 mx-auto" />
                <p className="text-sm font-medium mt-2">No projects yet</p>
                <p className="mt-1 text-sm text-muted-foreground max-w-xs mx-auto">
                  Describe your presentation above and we&apos;ll handle the rest.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {projects.map((project, i) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 + i * 0.03, duration: 0.35, ease }}
                    className="group text-left rounded-xl border border-border bg-card p-4 transition-colors duration-150 hover:border-primary/30 hover:bg-card/80 relative cursor-pointer"
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <button
                      className="absolute top-2.5 right-2.5 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: project.id, name: project.name }); }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <p className="text-sm font-medium line-clamp-1 pr-6">{project.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{project.prompt || "No description"}</p>
                    <div className="flex items-center gap-1.5 mt-3">
                      <Badge variant="secondary" className="text-[10px]">{project.audienceType}</Badge>
                      {project._count.presentations > 0 && (
                        <Badge variant="outline" className="text-[10px]">{project._count.presentations} deck{project._count.presentations > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-2">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(project.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </main>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="bg-card border border-border rounded-xl p-6 w-[400px] max-w-[90vw] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold">Delete project?</h3>
              <p className="text-sm text-muted-foreground mt-2">
                Are you sure you want to delete <span className="font-medium text-foreground">&quot;{deleteConfirm.name}&quot;</span>? This will permanently remove all presentations, files, and chat history.
              </p>
              <div className="flex items-center justify-end gap-2 mt-5">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
