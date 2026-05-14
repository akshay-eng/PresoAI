"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft, LifeBuoy, Loader2, MailOpen, MessageSquare, AlertCircle, AlertTriangle,
  CheckCircle2, Archive, ExternalLink, Save, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_LIST = ["open", "in_progress", "resolved", "closed", "all"] as const;
type Status = (typeof STATUS_LIST)[number];

interface Ticket {
  id: string;
  category: string;
  severity: string;
  area: string;
  description: string;
  projectId: string | null;
  url: string | null;
  userAgent: string | null;
  status: string;
  adminNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name: string | null };
}

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature request",
  ui_issue: "UI / UX",
  performance: "Performance",
  billing: "Billing",
  account: "Account",
  other: "Other",
};
const AREA_LABEL: Record<string, string> = {
  generation: "Generation",
  editing: "Editing",
  preview: "Preview",
  dashboard: "Dashboard",
  api: "API / MCP",
  account: "Account",
  other: "Other",
};

const ease = [0.22, 1, 0.36, 1] as const;

export function AdminSupportDashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("open");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState<string>("");

  const { data, isLoading } = useQuery<{ items: Ticket[]; summary: Record<string, number> }>({
    queryKey: ["admin-support", status],
    queryFn: async () => {
      const r = await fetch(`/api/admin/support?status=${status}`);
      if (!r.ok) throw new Error("Failed to load tickets");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const r = await fetch(`/api/admin/support/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Update failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-support"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tickets = data?.items || [];
  const summary = data?.summary || {};

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="flex items-end justify-between gap-4 flex-wrap"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <LifeBuoy className="h-4 w-4 text-primary" />
              <h1 className="text-xl font-semibold tracking-tight">Support Tickets</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              User-filed issues. Triage by changing status; reply via admin notes (shown to the user).
            </p>
          </div>
          <button
            onClick={() => router.push("/admin")}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to admin
          </button>
        </motion.div>

        {/* Summary chips */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.4, ease }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          <SummaryCard tone="amber" icon={<AlertCircle className="h-4 w-4" />} label="Open" value={summary.open ?? 0} />
          <SummaryCard tone="blue"  icon={<MessageSquare className="h-4 w-4" />} label="In progress" value={summary.in_progress ?? 0} />
          <SummaryCard tone="green" icon={<CheckCircle2 className="h-4 w-4" />} label="Resolved" value={summary.resolved ?? 0} />
          <SummaryCard tone="grey"  icon={<Archive className="h-4 w-4" />} label="Closed" value={summary.closed ?? 0} />
        </motion.div>

        {/* Filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_LIST.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-[11px] px-3 py-1.5 rounded-md transition-colors capitalize ${
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Tickets — card list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="rounded-xl border border-border bg-card px-5 py-12 flex justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
              <MailOpen className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium">No tickets in this view</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                When users file issues from /support they&apos;ll appear here.
              </p>
            </div>
          ) : (
            tickets.map((t) => {
              const isEditing = editingId === t.id;
              return (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-border bg-card p-5 space-y-3"
                >
                  {/* Top row: meta */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <StatusBadge status={t.status} />
                      <SeverityBadge severity={t.severity} />
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABEL[t.category] ?? t.category}
                      </span>
                      <span className="text-muted-foreground/30">·</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {AREA_LABEL[t.area] ?? t.area}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(t.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Reporter */}
                  <div className="flex items-center gap-2 text-xs">
                    <div className="h-6 w-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-semibold">
                      {(t.user.name?.[0] || t.user.email[0] || "?").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{t.user.name || t.user.email}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{t.user.email}</p>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                      {t.description}
                    </p>
                  </div>

                  {/* Tech context */}
                  {(t.url || t.userAgent || t.projectId) && (
                    <div className="rounded-md bg-muted/30 px-3 py-2 space-y-1 text-[10px] text-muted-foreground font-mono">
                      {t.projectId && (
                        <a
                          href={`/projects/${t.projectId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          project {t.projectId}
                        </a>
                      )}
                      {t.url && <p className="truncate">URL: {t.url}</p>}
                      {t.userAgent && <p className="truncate">UA: {t.userAgent}</p>}
                    </div>
                  )}

                  {/* Admin notes (display or edit) */}
                  {isEditing ? (
                    <div className="rounded-md border border-primary/30 bg-primary/[0.04] p-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">Admin reply (shown to user)</p>
                      <textarea
                        autoFocus
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        className="w-full bg-transparent text-sm outline-none border-0 p-0 focus:ring-0 resize-none"
                        placeholder="What you'd like to say back…"
                      />
                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-primary/15">
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditNotes("");
                          }}
                          className="text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3 inline mr-0.5" />
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            patchMutation.mutate({
                              id: t.id,
                              body: { adminNotes: editNotes.trim() || null },
                            });
                            setEditingId(null);
                            setEditNotes("");
                          }}
                          className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground"
                        >
                          <Save className="h-3 w-3 inline mr-0.5" />
                          Save
                        </button>
                      </div>
                    </div>
                  ) : t.adminNotes ? (
                    <div className="rounded-md bg-primary/[0.04] border border-primary/15 px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">Admin reply</p>
                        <button
                          onClick={() => {
                            setEditingId(t.id);
                            setEditNotes(t.adminNotes || "");
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Edit
                        </button>
                      </div>
                      <p className="text-xs text-foreground/85">{t.adminNotes}</p>
                    </div>
                  ) : null}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-border/60 flex-wrap">
                    <span className="text-[10px] text-muted-foreground mr-2">Set status:</span>
                    {(["open", "in_progress", "resolved", "closed"] as const).map((s) => (
                      <button
                        key={s}
                        disabled={t.status === s || patchMutation.isPending}
                        onClick={() => patchMutation.mutate({ id: t.id, body: { status: s } })}
                        className={`text-[10px] px-2 py-1 rounded-md transition-colors capitalize ${
                          t.status === s
                            ? "bg-primary/10 text-primary cursor-default"
                            : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.replace("_", " ")}
                      </button>
                    ))}
                    <span className="flex-1" />
                    {!t.adminNotes && !isEditing && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          setEditingId(t.id);
                          setEditNotes("");
                        }}
                      >
                        <MessageSquare className="h-3 w-3 mr-1" />
                        Reply
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  tone,
  icon,
  label,
  value,
}: {
  tone: "amber" | "blue" | "green" | "grey";
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  const cls =
    tone === "amber" ? "text-amber-500 bg-amber-500/10" :
    tone === "blue" ? "text-blue-500 bg-blue-500/10" :
    tone === "green" ? "text-emerald-500 bg-emerald-500/10" :
    "text-muted-foreground bg-muted/40";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <div className={`h-7 w-7 rounded-md flex items-center justify-center ${cls}`}>{icon}</div>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: string; label: string }> = {
    open: { tone: "bg-amber-500/10 text-amber-500", label: "Open" },
    in_progress: { tone: "bg-blue-500/10 text-blue-500", label: "In progress" },
    resolved: { tone: "bg-emerald-500/10 text-emerald-500", label: "Resolved" },
    closed: { tone: "bg-muted/50 text-muted-foreground", label: "Closed" },
  };
  const cfg = map[status] || { tone: "bg-muted/50 text-muted-foreground", label: status };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.tone}`}>{cfg.label}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { tone: string; icon?: React.ReactNode }> = {
    low: { tone: "bg-muted/50 text-muted-foreground" },
    medium: { tone: "bg-blue-500/10 text-blue-500" },
    high: { tone: "bg-orange-500/10 text-orange-500" },
    critical: { tone: "bg-rose-500/10 text-rose-500", icon: <AlertTriangle className="h-2.5 w-2.5" /> },
  };
  const cfg = map[severity] || { tone: "bg-muted/50 text-muted-foreground" };
  return (
    <Badge
      variant="outline"
      className={`text-[9px] h-4 px-1.5 uppercase font-medium border-0 ${cfg.tone} inline-flex items-center gap-1`}
    >
      {cfg.icon}
      {severity}
    </Badge>
  );
}
