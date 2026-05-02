"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Mic,
  FileText,
  Sparkles,
  Loader2,
  Plus,
  X,
  ScrollText,
  Volume2,
  Music,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { toast } from "sonner";

const ease = [0.22, 1, 0.36, 1] as const;

const BG_MUSIC_OPTIONS = [
  { value: "none", label: "No music" },
  { value: "tech", label: "Tech / Sci-Fi", filename: "Bensound-Scifi-Tech-Sound.mp3" },
  { value: "generic", label: "Creative / Upbeat", filename: "Bensound-Creative_minds-Sound.mp3" },
] as const;

type BgMusicValue = "none" | "tech" | "generic";

interface NarrativeGoal {
  id: string;
  timestamp: string;
  gist: string;
  keywords: string;
  maxDuration: string;
}

interface LLMModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
}

// ── C# backend response types (snake_case from ASP.NET SnakeCaseLower policy) ──

interface TtsConfig {
  voice: string;
  speed: number;
  emotion: string;
}

interface ScriptSegment {
  id: string;
  start_time_seconds: number;
  end_time_seconds: number;
  target_duration: number;
  script: string;
  tts_config: TtsConfig;
}

interface NarrationScript {
  project_id: string;
  generated_at: string;
  segments: ScriptSegment[];
}

interface SegmentAudioResult {
  segment_id: string;
  start_time_seconds: number;
  actual_duration: number;
  target_duration: number;
  wav_base64: string;
}

interface OrchestrationResult {
  script: NarrationScript;
  segment_audio: SegmentAudioResult[];
  final_mix_wav_base64: string;
}

// ── Small sub-components ───────────────────────────────────────────────────────

function useAudioUrl(base64: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64) {
      setUrl(null);
      return;
    }
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/wav" });
    const blobUrl = URL.createObjectURL(blob);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [base64]);

  return url;
}

function AudioPlayer({ base64 }: { base64: string }) {
  const url = useAudioUrl(base64);
  if (!url) return null;
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls src={url} className="w-full h-8" />;
}

function DownloadButton({ base64, filename }: { base64: string; filename: string }) {
  function handleDownload() {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 text-[10px] gap-1 px-2 text-muted-foreground hover:text-foreground"
      onClick={handleDownload}
    >
      <Download className="h-3 w-3" />
      Download
    </Button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function VoiceOverPage() {
  const router = useRouter();
  useSession({ required: true });

  // Form state
  const [projectName, setProjectName] = useState("");
  const [globalContext, setGlobalContext] = useState("");
  const [goals, setGoals] = useState<NarrativeGoal[]>([
    { id: "goal-1", timestamp: "", gist: "", keywords: "", maxDuration: "" },
  ]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [bgMusic, setBgMusic] = useState<BgMusicValue>("none");
  const [bgVolume, setBgVolume] = useState(30);

  // Pipeline state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<NarrationScript | null>(null);
  const [orchestrationResult, setOrchestrationResult] = useState<OrchestrationResult | null>(null);

  // Load available AI models (filtered by user's configured provider keys)
  const { data: modelsData } = useQuery({
    queryKey: ["llm-models"],
    queryFn: async () => {
      const r = await fetch("/api/llm/models");
      if (!r.ok) return { models: [] as LLMModel[], configuredProviders: [] as string[], isFreeTier: true };
      return r.json() as Promise<{ models: LLMModel[]; configuredProviders: string[]; isFreeTier: boolean }>;
    },
  });

  const models = modelsData?.models ?? [];

  // Auto-select default model once the list loads
  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      const def = models.find((m) => m.isDefault) ?? models[0];
      if (def) setSelectedModelId(def.id);
    }
  }, [models, selectedModelId]);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;

  // ── Goal management ──────────────────────────────────────────────────────────

  function addGoal() {
    setGoals((prev) => [
      ...prev,
      { id: `goal-${Date.now()}`, timestamp: "", gist: "", keywords: "", maxDuration: "" },
    ]);
  }

  function removeGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  function updateGoal(id: string, field: keyof NarrativeGoal, value: string) {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
  }

  // ── Generate script ──────────────────────────────────────────────────────────

  async function handleGenerateScript() {
    if (!selectedModel) {
      toast.error("Select an AI model first.");
      return;
    }
    if (!projectName.trim()) {
      toast.error("Enter a project name.");
      return;
    }
    if (goals.every((g) => !g.gist.trim())) {
      toast.error("Add at least one narrative goal.");
      return;
    }

    setIsGenerating(true);
    setGeneratedScript(null);
    setOrchestrationResult(null);

    try {
      const res = await fetch("/api/voice-over/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          project_name: projectName.trim(),
          global_context: globalContext.trim(),
          narrative_goals: goals
            .filter((g) => g.gist.trim())
            .map((g) => ({
              timestamp: g.timestamp.trim() || null,
              gist: g.gist.trim(),
              keywords: g.keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
              max_duration: g.maxDuration ? parseFloat(g.maxDuration) : null,
            })),
        }),
      });

      const data = (await res.json()) as NarrationScript & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

      setGeneratedScript(data);
      toast.success(`Script ready — ${data.segments?.length ?? 0} segments generated.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Orchestrate (synthesize + mix) ───────────────────────────────────────────

  async function handleSynthesize() {
    if (!generatedScript || !selectedModel) return;

    setIsSynthesizing(true);
    setOrchestrationResult(null);

    try {
      const bgOption = BG_MUSIC_OPTIONS.find((o) => o.value === bgMusic);
      const backgroundMusic =
        bgMusic !== "none" && bgOption && "filename" in bgOption
          ? { track_file_name: bgOption.filename, volume_percent: bgVolume }
          : null;

      const res = await fetch("/api/voice-over/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedModel.provider,
          model: selectedModel.model,
          script: generatedScript,
          background_music: backgroundMusic,
        }),
      });

      const data = (await res.json()) as OrchestrationResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

      setOrchestrationResult(data);
      toast.success("Audio synthesis complete!");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsSynthesizing(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex">
      <AppSidebar />

      <div className="flex-1 ml-[72px]">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto flex h-12 items-center gap-3 px-6">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => router.push("/dashboard")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Mic className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">Voice Over</h1>
          </div>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="max-w-3xl mx-auto px-6 py-8 space-y-6"
        >
          {/* ── Script Configuration ─────────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Script Configuration</h2>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Project name + AI model — two columns */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">Project name</p>
                  <Input
                    placeholder="e.g. Q3 Product Demo"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground font-medium">AI model</p>
                  {models.length === 0 ? (
                    <div className="h-8 rounded-md border border-input bg-muted/30 flex items-center px-3 text-xs text-muted-foreground">
                      No models — add an API key in{" "}
                      <button
                        className="underline ml-1 hover:text-foreground"
                        onClick={() => router.push("/settings")}
                      >
                        Settings
                      </button>
                    </div>
                  ) : (
                    <select
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Global context */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">Global context</p>
                <textarea
                  placeholder="Describe the overall topic, audience, and tone of the narration…"
                  value={globalContext}
                  onChange={(e) => setGlobalContext(e.target.value)}
                  rows={3}
                  className="w-full text-xs rounded-md border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {/* Narrative goals */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground font-medium">
                    Narrative goals
                    <span className="ml-2 text-muted-foreground/50">
                      — one per presentation segment
                    </span>
                  </p>
                  <span className="text-[10px] text-muted-foreground/50">
                    {goals.length} segment{goals.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="space-y-2">
                  {goals.map((goal, idx) => (
                    <div
                      key={goal.id}
                      className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2"
                    >
                      {/* Row 1: index + timestamp + gist + max-duration + remove */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/50 w-4 text-right shrink-0 font-mono">
                          {idx + 1}
                        </span>
                        <Input
                          placeholder="0:00"
                          value={goal.timestamp}
                          onChange={(e) => updateGoal(goal.id, "timestamp", e.target.value)}
                          className="text-xs h-7 w-16 shrink-0"
                          title="Timestamp (e.g. 0:00)"
                        />
                        <Input
                          placeholder="What to narrate at this point…"
                          value={goal.gist}
                          onChange={(e) => updateGoal(goal.id, "gist", e.target.value)}
                          className="text-xs h-7 flex-1"
                        />
                        <Input
                          placeholder="Max (s)"
                          type="number"
                          min={1}
                          value={goal.maxDuration}
                          onChange={(e) => updateGoal(goal.id, "maxDuration", e.target.value)}
                          className="text-xs h-7 w-20 shrink-0"
                          title="Maximum duration in seconds"
                        />
                        {goals.length > 1 && (
                          <button
                            onClick={() => removeGoal(goal.id)}
                            className="p-1 text-muted-foreground/30 hover:text-destructive transition-colors shrink-0"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Row 2: keywords */}
                      <div className="flex items-center gap-2 pl-6">
                        <Input
                          placeholder="Keywords, comma-separated (optional)"
                          value={goal.keywords}
                          onChange={(e) => updateGoal(goal.id, "keywords", e.target.value)}
                          className="text-xs h-7 flex-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  onClick={addGoal}
                >
                  <Plus className="h-3 w-3" />
                  Add segment
                </Button>
              </div>

              {/* Generate button */}
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={handleGenerateScript}
                  disabled={isGenerating || !selectedModel || !projectName.trim()}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generating script…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate script
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* ── Generated Script ─────────────────────────────────────────── */}
          {generatedScript && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease }}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              {/* Card header + Synthesize button */}
              <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Generated Script</h2>
                  <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                    {generatedScript.segments.length} segments
                  </span>
                </div>

                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleSynthesize}
                  disabled={isSynthesizing}
                >
                  {isSynthesizing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Synthesizing…
                    </>
                  ) : (
                    <>
                      <Volume2 className="h-3 w-3" />
                      Synthesize audio
                    </>
                  )}
                </Button>
              </div>

              {/* Background music selector */}
              <div className="px-5 py-3 border-b border-border/40 bg-muted/10">
                <div className="flex items-center gap-5 flex-wrap">
                  <span className="text-[11px] text-muted-foreground font-medium shrink-0">
                    Background music:
                  </span>
                  {BG_MUSIC_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-1.5 cursor-pointer text-xs"
                    >
                      <input
                        type="radio"
                        name="bg-music"
                        value={opt.value}
                        checked={bgMusic === opt.value}
                        onChange={() => setBgMusic(opt.value)}
                        className="accent-primary"
                      />
                      {opt.label}
                    </label>
                  ))}

                  {bgMusic !== "none" && (
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[11px] text-muted-foreground">Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={bgVolume}
                        onChange={(e) => setBgVolume(Number(e.target.value))}
                        className="w-24 accent-primary"
                      />
                      <span className="text-[11px] text-muted-foreground w-7 text-right tabular-nums">
                        {bgVolume}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Script segments */}
              <div className="divide-y divide-border/30">
                {generatedScript.segments.map((seg) => (
                  <div key={seg.id} className="px-5 py-3 space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
                        {formatTime(seg.start_time_seconds)} – {formatTime(seg.end_time_seconds)}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                        {seg.id}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">
                        {seg.target_duration}s target
                      </span>
                    </div>

                    <p className="text-xs text-foreground/90 leading-relaxed">{seg.script}</p>

                    {seg.tts_config?.voice && (
                      <div className="flex gap-3 text-[10px] text-muted-foreground/50">
                        <span>voice: {seg.tts_config.voice}</span>
                        <span>speed: {seg.tts_config.speed}x</span>
                        {seg.tts_config.emotion && <span>emotion: {seg.tts_config.emotion}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Synthesis progress bar */}
              {isSynthesizing && (
                <div className="px-5 py-3 border-t border-border/40 flex items-center gap-2 text-xs text-muted-foreground bg-muted/10">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                  Synthesizing audio and assembling the final mix… This may take a minute.
                </div>
              )}
            </motion.div>
          )}

          {/* ── Audio Output ─────────────────────────────────────────────── */}
          {orchestrationResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease }}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Audio Output</h2>
              </div>

              {/* Final mix */}
              {orchestrationResult.final_mix_wav_base64 && (
                <div className="px-5 py-4 border-b border-border/40">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium">Final Mix</p>
                    <DownloadButton
                      base64={orchestrationResult.final_mix_wav_base64}
                      filename={`${orchestrationResult.script?.project_id ?? projectName}_final_mix.wav`}
                    />
                  </div>
                  <AudioPlayer base64={orchestrationResult.final_mix_wav_base64} />
                </div>
              )}

              {/* Per-segment audio */}
              {orchestrationResult.segment_audio.length > 0 && (
                <div className="px-5 py-4">
                  <p className="text-[11px] text-muted-foreground font-medium mb-3">
                    Segment Audio ({orchestrationResult.segment_audio.length})
                  </p>

                  <div className="space-y-3">
                    {orchestrationResult.segment_audio.map((seg) => (
                      <div
                        key={seg.segment_id}
                        className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                              {seg.segment_id}
                            </span>
                            <span className="text-[10px] text-muted-foreground/50">
                              {formatTime(seg.start_time_seconds)} · {seg.actual_duration.toFixed(1)}s
                            </span>
                          </div>
                          <DownloadButton
                            base64={seg.wav_base64}
                            filename={`${seg.segment_id}.wav`}
                          />
                        </div>
                        <AudioPlayer base64={seg.wav_base64} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
