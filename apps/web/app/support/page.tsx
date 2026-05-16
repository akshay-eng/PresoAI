"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { LifeBuoy, CheckCircle2, AlertCircle, Loader2, Send } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Bug — something broke" },
  { value: "feature_request", label: "Feature request" },
  { value: "ui_issue", label: "UI / UX issue" },
  { value: "performance", label: "Slow / performance issue" },
  { value: "billing", label: "Billing / credits" },
  { value: "account", label: "Account access" },
  { value: "other", label: "Other" },
];

const SEVERITY_OPTIONS = [
  { value: "low", label: "Low — minor inconvenience" },
  { value: "medium", label: "Medium — usable but degraded" },
  { value: "high", label: "High — feature is blocked" },
  { value: "critical", label: "Critical — system unusable" },
];

const AREA_OPTIONS = [
  { value: "generation", label: "Generation — creating decks" },
  { value: "editing", label: "Editing — surgical edits / follow-ups" },
  { value: "preview", label: "Preview / Download" },
  { value: "dashboard", label: "Dashboard / project list" },
  { value: "api", label: "REST API / MCP" },
  { value: "account", label: "Account / Settings" },
  { value: "other", label: "Other" },
];

interface Ticket {
  id: string;
  ticketNumber: string;
  category: string;
  severity: string;
  area: string;
  description: string;
  status: string;
  adminNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const ease = [0.22, 1, 0.36, 1] as const;

export default function SupportPage() {
  useSession({ required: true });
  const router = useRouter();

  const [category, setCategory] = useState<string>("");
  const [severity, setSeverity] = useState<string>("medium");
  const [area, setArea] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const { data: myTickets } = useQuery<{ items: Ticket[] }>({
    queryKey: ["my-support-tickets"],
    queryFn: async () => {
      const r = await fetch("/api/support");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          severity,
          area,
          description: description.trim(),
          url: typeof window !== "undefined" ? window.location.href : undefined,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to submit");
      }
      return r.json();
    },
    onSuccess: (data: { ticketNumber?: string }) => {
      toast.success(
        data?.ticketNumber
          ? `Thanks — filed as ${data.ticketNumber}.`
          : "Thanks — we got it."
      );
      setCategory("");
      setSeverity("medium");
      setArea("");
      setDescription("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit =
    !!category && !!severity && !!area && description.trim().length >= 10 && !submitMutation.isPending;

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar />
      <main className="flex-1 ml-[72px]">
        <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <div className="flex items-center gap-2 mb-1">
              <LifeBuoy className="h-4 w-4 text-primary" />
              <h1 className="text-xl font-semibold tracking-tight">Support</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Hit a bug or want a feature? Tell us what happened — pick a few tags and write a short
              description. We&apos;ll triage from the admin dashboard.
            </p>
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.4, ease }}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submitMutation.mutate();
            }}
            className="rounded-xl border border-border bg-card p-6 space-y-5"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormSelect
                label="Category"
                required
                value={category}
                onChange={setCategory}
                placeholder="Pick a category"
                options={CATEGORY_OPTIONS}
              />
              <FormSelect
                label="Severity"
                required
                value={severity}
                onChange={setSeverity}
                options={SEVERITY_OPTIONS}
              />
              <FormSelect
                label="Area"
                required
                value={area}
                onChange={setArea}
                placeholder="Where in the app?"
                options={AREA_OPTIONS}
              />
            </div>

            <div>
              <label className="text-xs font-medium mb-1.5 block">
                What happened? <span className="text-rose-500">*</span>
                <span className="text-muted-foreground font-normal ml-1">
                  Be specific — steps to reproduce, what you expected, what you saw.
                </span>
              </label>
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When I clicked Generate, the progress bar got stuck at 70% for ~10 minutes..."
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm resize-y outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-colors min-h-[140px]"
                maxLength={4000}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-muted-foreground">
                  {description.length < 10 ? `${10 - description.length} more chars` : `${description.length} / 4000`}
                </span>
                {description.length >= 10 && (
                  <span className="text-[11px] text-emerald-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Ready to send
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <p className="text-[11px] text-muted-foreground">
                Your account email, current URL, and browser are attached automatically.
              </p>
              <Button type="submit" disabled={!canSubmit} size="sm" className="gap-1.5">
                {submitMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Submit ticket
              </Button>
            </div>
          </motion.form>

          {/* History — the user's own tickets */}
          {myTickets && myTickets.items.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4, ease }}
            >
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
                Your tickets ({myTickets.items.length})
              </h2>
              <ul className="space-y-2">
                {myTickets.items.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] font-semibold text-foreground bg-secondary/60 rounded px-1.5 py-0.5">
                            {t.ticketNumber}
                          </span>
                          <StatusBadge status={t.status} />
                          <SeverityBadge severity={t.severity} />
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {labelFor(t.category, CATEGORY_OPTIONS)}
                          </span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {labelFor(t.area, AREA_OPTIONS)}
                          </span>
                        </div>
                        <p className="text-sm mt-1.5 text-foreground/90 line-clamp-3">{t.description}</p>
                        {t.adminNotes && (
                          <div className="mt-2.5 rounded-md bg-primary/[0.04] border border-primary/20 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-primary mb-1">Admin reply</p>
                            <p className="text-xs text-foreground/85">{t.adminNotes}</p>
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {/* Back link */}
          <div className="pt-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to dashboard
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function FormSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-colors"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
  const map: Record<string, string> = {
    low: "bg-muted/50 text-muted-foreground",
    medium: "bg-blue-500/10 text-blue-500",
    high: "bg-orange-500/10 text-orange-500",
    critical: "bg-rose-500/10 text-rose-500",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[9px] h-4 px-1.5 uppercase font-medium border-0 ${map[severity] || "bg-muted/50"}`}
    >
      {severity}
    </Badge>
  );
}

function labelFor(value: string, options: Array<{ value: string; label: string }>): string {
  return options.find((o) => o.value === value)?.label?.split(" — ")[0] || value;
}
