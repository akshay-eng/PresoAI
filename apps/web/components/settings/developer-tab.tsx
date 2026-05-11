"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Code2, Plus, Loader2, Trash2, Copy, Eye, EyeOff, X, CheckCircle, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const EXPIRY_CHOICES: Array<{ value: string; label: string }> = [
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "1y", label: "1 year" },
  { value: "never", label: "Never expires" },
];

export function DeveloperTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>("never");
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [revealLoading, setRevealLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ApiKey | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["developer-api-keys"],
    queryFn: async () => {
      const r = await fetch("/api/developer/keys");
      if (!r.ok) return [];
      return (await r.json()) as ApiKey[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/developer/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim(), expiry: newKeyExpiry }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create key");
      }
      return (await res.json()) as { name: string; key: string };
    },
    onSuccess: (data) => {
      setCreatedKey({ name: data.name, key: data.key });
      setShowCreate(false);
      setNewKeyName("");
      setNewKeyExpiry("never");
      queryClient.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/developer/keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      toast.success("Key deleted");
      setDeleteConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["developer-api-keys"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function handleReveal(id: string) {
    if (revealedKeys[id]) {
      // Already revealed — toggle hidden
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setRevealLoading(id);
    try {
      const r = await fetch(`/api/developer/keys/${id}`);
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "Failed to retrieve key");
      }
      const data = (await r.json()) as { key: string };
      setRevealedKeys((prev) => ({ ...prev, [id]: data.key }));
    } catch (err) {
      toast.error((err as Error).message);
    }
    setRevealLoading(null);
  }

  async function handleCopy(text: string, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access");
    }
  }

  async function handleCopyKey(id: string) {
    let value = revealedKeys[id];
    if (!value) {
      // Fetch on demand without revealing in the UI.
      try {
        const r = await fetch(`/api/developer/keys/${id}`);
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.error || "Failed to retrieve key");
        }
        value = ((await r.json()) as { key: string }).key;
      } catch (err) {
        toast.error((err as Error).message);
        return;
      }
    }
    await handleCopy(value, "Key copied to clipboard");
  }

  function expiryLabel(k: ApiKey): { text: string; tone: "ok" | "warn" | "expired" | "revoked" | "muted" } {
    if (k.revokedAt) return { text: "Revoked", tone: "revoked" };
    if (!k.expiresAt) return { text: "Never expires", tone: "muted" };
    const exp = new Date(k.expiresAt).getTime();
    const now = Date.now();
    if (exp < now) return { text: "Expired", tone: "expired" };
    const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 7) return { text: `Expires in ${daysLeft}d`, tone: "warn" };
    return { text: `Expires ${new Date(k.expiresAt).toLocaleDateString()}`, tone: "ok" };
  }

  return (
    <>
      {/* Section heading — outside the card, plain header pattern matching the
          rest of Settings (consistent with Usage, Coupon, etc.) */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Code2 className="h-3.5 w-3.5 text-primary" />
            API keys
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            For the public REST API and MCP server. Treat each key like a password.
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Generate key
        </Button>
      </div>

      {/* Keys list — empty state OR rows */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="px-5 py-10 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Code2 className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs font-medium">No API keys yet</p>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-xs mx-auto">
              Generate one to start calling the Preso API or connect an MCP client.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {keys.map((k) => {
              const exp = expiryLabel(k);
              const revealed = revealedKeys[k.id];
              const masked = `${k.prefix}${"•".repeat(8)}${k.last4}`;
              return (
                <div key={k.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
                  {/* Left column — name, badge, key value, meta */}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium truncate">{k.name}</p>
                      <Badge
                        variant={
                          exp.tone === "revoked" || exp.tone === "expired"
                            ? "destructive"
                            : exp.tone === "warn"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-[9px] h-4 px-1.5 shrink-0"
                      >
                        {exp.text}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">
                      {revealed ? revealed : masked}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsedAt && (
                        <> · last used {new Date(k.lastUsedAt).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>

                  {/* Right column — actions, vertically centered */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => handleReveal(k.id)}
                      title={revealed ? "Hide key" : "Reveal key"}
                    >
                      {revealLoading === k.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : revealed ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => handleCopyKey(k.id)}
                      title="Copy key"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={() => setDeleteConfirm(k)}
                      title="Delete key"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Generate-key modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-card rounded-2xl border border-border shadow-2xl max-w-sm w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Generate API key</h3>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Name</label>
                  <Input
                    placeholder="e.g. Local MCP server, n8n integration"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="text-xs h-8"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Expiry</label>
                  <div className="grid grid-cols-3 gap-1">
                    {EXPIRY_CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewKeyExpiry(c.value)}
                        className={`rounded-md py-1.5 text-[11px] transition-colors ${
                          newKeyExpiry === c.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full h-8 text-xs"
                  disabled={!newKeyName.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  Generate
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Created-key reveal modal — shown ONCE on creation, with a copy nudge */}
      <AnimatePresence>
        {createdKey && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
            onClick={() => setCreatedKey(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-card rounded-2xl border border-border shadow-2xl max-w-md w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Your new API key</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Copy this now and store it somewhere safe. You can re-reveal it later from the
                    list, but never share it publicly — anyone with this key can call the API on
                    your behalf.
                  </p>
                </div>
              </div>

              <div className="rounded-md bg-muted/60 px-3 py-2.5 font-mono text-xs break-all border border-border">
                {createdKey.key}
              </div>

              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-8 text-xs"
                  onClick={() => handleCopy(createdKey.key, "Key copied")}
                >
                  <Copy className="h-3 w-3 mr-1.5" />
                  Copy
                </Button>
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => setCreatedKey(null)}
                >
                  Done
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-6"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-card rounded-2xl border border-border shadow-2xl max-w-sm w-full p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold">Delete API key?</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Any client using <span className="font-medium text-foreground">{deleteConfirm.name}</span> will
                    immediately lose access to the API. This can&apos;t be undone.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Delete
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer note about API + MCP coming next */}
      <p className="text-[11px] text-muted-foreground/70 mt-4 px-1">
        <span className="font-medium text-foreground/80">Coming next:</span> the public REST API
        and MCP server endpoints these keys authenticate — docs and base URL will appear here once they&apos;re live.
      </p>
    </>
  );
}
