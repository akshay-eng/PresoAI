"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

const addModelSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["openai", "azure", "anthropic", "google", "mistral", "custom"]),
  model: z.string().min(1),
  baseUrl: z.string().url().optional().or(z.literal("")),
  apiKey: z.string().optional(),
});

type AddModelForm = z.infer<typeof addModelSchema>;

interface LLMSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
}

export function LLMSelector({ selectedModelId, onModelChange }: LLMSelectorProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: models } = useQuery({
    queryKey: ["llm-models"],
    queryFn: () => api.listModels(),
  });

  const addMutation = useMutation({
    mutationFn: (data: AddModelForm) =>
      api.createLLMConfig({ ...data, baseUrl: data.baseUrl || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["llm-models"] });
      setShowAddForm(false);
      toast.success("Model added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { register, handleSubmit, formState: { errors } } = useForm<AddModelForm>({
    resolver: zodResolver(addModelSchema),
    defaultValues: { provider: "openai" },
  });

  const modelsData = models as { models?: unknown[]; isFreeTier?: boolean } | unknown[] | undefined;
  const modelList = (Array.isArray(modelsData) ? modelsData : (modelsData?.models || [])) as Array<{
    id: string; name: string; provider: string; model: string; isDefault: boolean;
  }>;
  const isFreeTier = !Array.isArray(modelsData) && modelsData?.isFreeTier;

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">AI Model</Label>
      <Select value={selectedModelId} onValueChange={onModelChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          {modelList.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name} ({m.provider})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFreeTier && (
        <p className="text-[10px] text-muted-foreground">
          Free tier — Gemini models only. <a href="/settings" className="text-primary hover:underline">Add API keys</a> to unlock all models.
        </p>
      )}

      {!showAddForm ? (
        <button
          className="w-full text-xs text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1 py-1"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-3 w-3" /> Add custom model
        </button>
      ) : (
        <form
          onSubmit={handleSubmit((data) => addMutation.mutate(data))}
          className="space-y-2 border border-border rounded-lg p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Add Model</span>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input placeholder="Display name" className="h-8 text-xs" {...register("name")} />
          {errors.name && <p className="text-[10px] text-destructive">{errors.name.message}</p>}
          <select
            className="flex h-8 w-full rounded-lg border border-border bg-secondary/50 px-3 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
            {...register("provider")}
          >
            <option value="openai">OpenAI</option>
            <option value="azure">Azure OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="mistral">Mistral</option>
            <option value="custom">Custom</option>
          </select>
          <Input placeholder="Model ID (e.g. gpt-4o)" className="h-8 text-xs" {...register("model")} />
          <Input placeholder="Base URL (optional)" className="h-8 text-xs" {...register("baseUrl")} />
          <Input placeholder="API Key" type="password" className="h-8 text-xs" {...register("apiKey")} />
          <Button type="submit" size="sm" className="w-full h-8 text-xs" disabled={addMutation.isPending}>
            Add Model
          </Button>
        </form>
      )}
    </div>
  );
}
