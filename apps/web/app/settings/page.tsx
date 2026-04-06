"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Shield, Loader2, Eye, EyeOff, Trash2, Zap, CheckCircle, Key } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { toast } from "sonner";

const ease = [0.22, 1, 0.36, 1] as const;

const PROVIDERS = [
  { id: "google", name: "Google Gemini", placeholder: "AIzaSy...", color: "#4285F4", icon: "G" },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-api03-...", color: "#D97706", icon: "A" },
  { id: "openai", name: "OpenAI", placeholder: "sk-...", color: "#10A37F", icon: "O" },
  { id: "mistral", name: "Mistral", placeholder: "...", color: "#FF7000", icon: "M" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { data: session } = useSession({ required: true });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [validating, setValidating] = useState<string | null>(null);

  const passwordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(typeof d.error === "string" ? d.error : "Failed"); }
    },
    onSuccess: () => { toast.success("Password changed"); setCurrentPassword(""); setNewPassword(""); },
    onError: (err: Error) => toast.error(err.message),
  });

  const { data: providerKeys = [], refetch: refetchKeys } = useQuery({
    queryKey: ["provider-keys"],
    queryFn: async () => {
      const r = await fetch("/api/settings/providers");
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: usage } = useQuery({
    queryKey: ["usage"],
    queryFn: async () => {
      const r = await fetch("/api/settings/usage");
      if (!r.ok) return null;
      return r.json();
    },
  });

  async function handleSaveKey(provider: string) {
    const apiKey = keyInputs[provider];
    if (!apiKey) return;
    setValidating(provider);
    try {
      const res = await fetch("/api/settings/providers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(data.error || "Validation failed");
      else { toast.success(data.message); setKeyInputs((p) => ({ ...p, [provider]: "" })); setExpandedProvider(null); refetchKeys(); }
    } catch (err) { toast.error((err as Error).message); }
    setValidating(null);
  }

  async function handleDeleteKey(provider: string) {
    await fetch("/api/settings/providers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
    toast.success("Key removed");
    refetchKeys();
  }

  const configuredSet = new Set((providerKeys as Array<{ provider: string }>).map((k) => k.provider));
  const configuredCount = configuredSet.size;

  return (
    <div className="min-h-screen flex">
      <AppSidebar />
      <div className="flex-1 ml-[72px]">
        <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto flex h-12 items-center gap-3 px-6">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.push("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-sm font-semibold">Settings</h1>
          </div>
        </header>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="max-w-2xl mx-auto px-6 py-8 space-y-8">

          {/* Usage card */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Usage</h2>
              </div>
            </div>
            <div className="px-5 py-4">
              {usage ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Free tier ({usage.freeTier.used}/{usage.freeTier.max})</span>
                      <span className="text-muted-foreground">
                        {usage.freeTier.remaining > 0
                          ? `${usage.freeTier.remaining} left`
                          : `Resets ${new Date(usage.freeTier.windowEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                        }
                      </span>
                    </div>
                    <Progress value={(usage.freeTier.used / Math.max(usage.freeTier.max, 1)) * 100} />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-lg bg-muted/40 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground">Tokens used</p>
                      <p className="text-base font-semibold tabular-nums">{usage.usage.totalTokens > 0 ? `${(usage.usage.totalTokens / 1000).toFixed(1)}K` : "0"}</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-muted/40 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground">Est. cost</p>
                      <p className="text-base font-semibold tabular-nums">${usage.usage.totalCostUsd > 0 ? usage.usage.totalCostUsd.toFixed(4) : "0.00"}</p>
                    </div>
                    <div className="flex-1 rounded-lg bg-muted/40 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground">Providers</p>
                      <p className="text-base font-semibold tabular-nums">{configuredCount}/4</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              )}
            </div>
          </div>

          {/* API Keys — compact grid */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border/40">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">API Keys</h2>
                </div>
                <p className="text-[10px] text-muted-foreground">{configuredCount} of 4 configured</p>
              </div>
            </div>
            <div className="divide-y divide-border/40">
              {PROVIDERS.map((prov) => {
                const isConfigured = configuredSet.has(prov.id);
                const isExpanded = expandedProvider === prov.id;
                const keyData = (providerKeys as Array<{ provider: string; lastValidated?: string }>).find((k) => k.provider === prov.id);

                return (
                  <div key={prov.id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: prov.color }}>
                        {prov.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{prov.name}</p>
                        {isConfigured && keyData?.lastValidated && (
                          <p className="text-[10px] text-muted-foreground">Validated {new Date(keyData.lastValidated).toLocaleDateString()}</p>
                        )}
                      </div>
                      {isConfigured ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          <button onClick={() => handleDeleteKey(prov.id)} className="p-1 rounded text-muted-foreground/40 hover:text-destructive transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedProvider(isExpanded ? null : prov.id)}>
                          {isExpanded ? "Cancel" : "Add key"}
                        </Button>
                      )}
                    </div>

                    {isExpanded && !isConfigured && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-3 flex gap-2 overflow-hidden">
                        <Input
                          type="password"
                          placeholder={prov.placeholder}
                          value={keyInputs[prov.id] || ""}
                          onChange={(e) => setKeyInputs((p) => ({ ...p, [prov.id]: e.target.value }))}
                          className="text-xs h-8"
                          autoFocus
                        />
                        <Button size="sm" className="h-8 shrink-0 text-xs" disabled={!keyInputs[prov.id] || validating === prov.id} onClick={() => handleSaveKey(prov.id)}>
                          {validating === prov.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </Button>
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Account + Password — side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-3">Account</h3>
              <div className="space-y-2">
                <div><p className="text-[10px] text-muted-foreground">Name</p><p className="text-sm">{session?.user?.name || "—"}</p></div>
                <div><p className="text-[10px] text-muted-foreground">Email</p><p className="text-sm">{session?.user?.email || "—"}</p></div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-3">Password</h3>
              <div className="space-y-2">
                <div className="relative">
                  <Input type={showPasswords ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current" className="text-xs h-8 pr-8" />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPasswords(!showPasswords)}>
                    {showPasswords ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </button>
                </div>
                <Input type={showPasswords ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New (min 8 chars)" className="text-xs h-8" />
                <Button size="sm" className="w-full h-8 text-xs" disabled={!currentPassword || newPassword.length < 8 || passwordMutation.isPending} onClick={() => passwordMutation.mutate()}>
                  {passwordMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Shield className="h-3 w-3 mr-1" />}
                  Update
                </Button>
              </div>
            </div>
          </div>

        </motion.div>
      </div>
    </div>
  );
}
