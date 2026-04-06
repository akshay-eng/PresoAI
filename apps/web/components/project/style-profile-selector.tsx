"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Plus, Upload, Loader2, CheckCircle, Palette, FileText, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api-client";

interface StyleProfileSelectorProps {
  selectedProfileId: string | null;
  onProfileChange: (profileId: string | null) => void;
  selectedModelId: string;
}

export function StyleProfileSelector({
  selectedProfileId,
  onProfileChange,
  selectedModelId,
}: StyleProfileSelectorProps) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);

  const { data: profiles } = useQuery({
    queryKey: ["style-profiles"],
    queryFn: async () => {
      const res = await fetch("/api/style-profiles");
      if (!res.ok) throw new Error("Failed to load profiles");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/style-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create profile");
      return res.json();
    },
    onSuccess: (profile: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
      setShowCreate(false);
      setNewProfileName("");
      setExpandedProfileId(profile.id);
      toast.success("Style profile created. Upload PPTX files to build it.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch(`/api/style-profiles/${profileId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModelId }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Analysis failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
      toast.success("Style analysis complete!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const res = await fetch(`/api/style-profiles/${profileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
      if (selectedProfileId) onProfileChange(null);
      toast.success("Profile deleted");
    },
  });

  const profileList = (profiles || []) as Array<{
    id: string; name: string; status: string; styleGuide?: string;
    sourceFiles: Array<{ id: string; fileName: string; status: string; slideCount: number }>;
    _count: { projects: number };
  }>;

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Palette className="h-3 w-3" />
        Style Profile
      </Label>

      <Select value={selectedProfileId || "none"} onValueChange={(v) => onProfileChange(v === "none" ? null : v)}>
        <SelectTrigger>
          <SelectValue placeholder="No style profile" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No style profile</SelectItem>
          {profileList.filter((p) => p.status === "ready").map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name} ({p.sourceFiles.length} files)</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!showCreate ? (
        <button
          className="w-full text-xs text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1 py-1"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-3 w-3" /> Create style profile
        </button>
      ) : (
        <div className="space-y-2 border border-border rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">New Profile</span>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input placeholder="Profile name" className="h-8 text-xs" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
          <Button size="sm" className="w-full h-8 text-xs" disabled={!newProfileName || createMutation.isPending} onClick={() => createMutation.mutate(newProfileName)}>
            Create
          </Button>
        </div>
      )}

      {profileList.map((p) => (
        <ProfileCard
          key={p.id}
          profile={p}
          isExpanded={expandedProfileId === p.id}
          onToggle={() => setExpandedProfileId(expandedProfileId === p.id ? null : p.id)}
          onAnalyze={() => analyzeMutation.mutate(p.id)}
          onDelete={() => deleteMutation.mutate(p.id)}
          isAnalyzing={analyzeMutation.isPending}
          canAnalyze={!!selectedModelId}
        />
      ))}
    </div>
  );
}

function ProfileCard({ profile, isExpanded, onToggle, onAnalyze, onDelete, isAnalyzing, canAnalyze }: {
  profile: { id: string; name: string; status: string; sourceFiles: Array<{ id: string; fileName: string; status: string; slideCount: number }> };
  isExpanded: boolean; onToggle: () => void; onAnalyze: () => void; onDelete: () => void; isAnalyzing: boolean; canAnalyze: boolean;
}) {
  const queryClient = useQueryClient();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        const presignRes = await fetch("/api/upload/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, purpose: "template" }) });
        const { signedUrl, key } = await presignRes.json();
        await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        await fetch(`/api/style-profiles/${profile.id}/sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ s3Key: key, fileName: file.name, fileSize: file.size }) });
        toast.success(`${file.name} added`);
      } catch { toast.error(`Failed to upload ${file.name}`); }
    }
    queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
  }, [profile.id, queryClient]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"] },
    disabled: isAnalyzing,
  });

  return (
    <div className="rounded-lg border border-dashed border-border overflow-hidden">
      <div className="flex items-center justify-between py-2 px-3">
        <button onClick={onToggle} className="flex items-center gap-2 text-left flex-1">
          <span className="text-xs font-medium">{profile.name}</span>
          <Badge variant={profile.status === "ready" ? "default" : "outline"} className="text-[10px]">{profile.status}</Badge>
        </button>
        <button className="text-muted-foreground hover:text-destructive transition-colors p-0.5" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="py-2 px-3 space-y-2 border-t border-border/60">
          {profile.sourceFiles.map((sf) => (
            <div key={sf.id} className="flex items-center gap-2 text-xs">
              <FileText className="h-3 w-3 text-muted-foreground/40" />
              <span className="truncate flex-1 text-muted-foreground">{sf.fileName}</span>
              <Badge variant="outline" className="text-[10px]">{sf.status}</Badge>
            </div>
          ))}
          <div {...getRootProps()} className={`flex items-center justify-center rounded border border-dashed border-border p-2 cursor-pointer transition-colors text-xs hover:border-primary/30 ${isDragActive ? "border-primary/40 bg-primary/5" : ""}`}>
            <input {...getInputProps()} />
            <Upload className="h-3 w-3 mr-1 text-muted-foreground/40" />
            <span className="text-muted-foreground/50">Drop .pptx files</span>
          </div>
          {profile.sourceFiles.length > 0 && profile.status !== "ready" && (
            <Button size="sm" className="w-full h-7 text-xs" disabled={isAnalyzing || !canAnalyze} onClick={onAnalyze}>
              {isAnalyzing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {isAnalyzing ? "Analyzing..." : "Analyze Style"}
            </Button>
          )}
          {profile.status === "ready" && (
            <p className="flex items-center gap-1 text-xs text-green-500"><CheckCircle className="h-3 w-3" /> Ready</p>
          )}
          {!canAnalyze && profile.status !== "ready" && (
            <p className="text-[10px] text-muted-foreground/50">Select an AI model first</p>
          )}
        </div>
      )}
    </div>
  );
}
