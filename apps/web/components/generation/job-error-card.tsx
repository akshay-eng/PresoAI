"use client";

import { AlertTriangle, ExternalLink, RefreshCw, Settings } from "lucide-react";
import Link from "next/link";
import type { JobError } from "@/lib/stores/generation-store";

/**
 * Inline error card shown in the project chat when a generation fails.
 * Surfaces the structured payload from the python-agent's error classifier:
 * a short title, an explanation, and a single concrete next action.
 *
 * Falls back to the raw error string for unclassified failures so we never
 * end up with a blank "Generation failed" panel.
 */
export function JobErrorCard({
  details,
  rawMessage,
  onRetry,
  onSwitchModel,
}: {
  details: JobError | null;
  rawMessage?: string | null;
  onRetry?: () => void;
  onSwitchModel?: () => void;
}) {
  const code = details?.code || "unknown";
  const title = details?.title || "Generation failed";
  const body =
    details?.message ||
    rawMessage ||
    "Something went wrong while generating the deck.";
  const hint = details?.hint;
  const provider = details?.provider;
  const retryable = details?.retryable ?? true;

  // Provider docs URL for billing-class errors — saves the user a Google trip.
  const billingDocs: Record<string, string> = {
    anthropic: "https://console.anthropic.com/settings/billing",
    openai: "https://platform.openai.com/settings/organization/billing/overview",
    google: "https://console.cloud.google.com/billing",
    mistral: "https://console.mistral.ai/billing",
  };
  const billingHref = provider ? billingDocs[provider] : undefined;

  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 max-w-2xl">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 h-6 w-6 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
          {hint && (
            <p className="text-xs text-foreground/70 mt-2 leading-relaxed">
              <span className="font-medium">What to do:</span> {hint}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {code === "billing_exhausted" && billingHref && (
              <a
                href={billingHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Add {provider} credits
              </a>
            )}
            {onSwitchModel && (code === "billing_exhausted" || code === "invalid_credentials" || code === "model_not_found" || code === "context_too_long") && (
              <button
                onClick={onSwitchModel}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Settings className="h-3 w-3" />
                Switch model
              </button>
            )}
            {code === "invalid_credentials" && (
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Settings className="h-3 w-3" />
                Open Settings
              </Link>
            )}
            {retryable && onRetry && (
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-secondary/60 text-foreground hover:bg-secondary transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">{code}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
