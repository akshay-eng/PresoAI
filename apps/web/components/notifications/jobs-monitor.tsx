"use client";

/**
 * Global background watcher for in-flight presentation jobs.
 *
 * Mounts once at the app root. For every project slot in the generation
 * store with `isGenerating: true`, it polls /api/jobs/<id> on a low-frequency
 * cadence (every 6s) and watches for terminal status.
 *
 * On completion / failure it:
 *   1. pushes a row into the persistent notification store
 *   2. fires a sonner toast — but ONLY when the user is NOT currently
 *      viewing that project's page (otherwise the page's own progress UI
 *      already shows the result, and the toast would feel duplicative)
 *   3. updates the generation store so the per-project state reflects the
 *      terminal phase
 *
 * Polling (not SSE) keeps the watcher cheap and avoids managing N parallel
 * EventSource connections from every tab the user has open. SSE is still
 * used by the active project page for sub-second updates.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { useGenerationStore } from "@/lib/stores/generation-store";
import { useNotificationStore } from "@/lib/stores/notification-store";

const POLL_INTERVAL_MS = 6000;
// Sonner default is 4 seconds — too easy to miss when the user is in
// another tab. 15s is long enough to be noticed when they come back,
// short enough that it eventually clears on its own.
const TOAST_DURATION_MS = 15_000;

/**
 * Request browser Notification permission once per session, lazily — the
 * first time we actually have a notification to fire. Avoids the awkward
 * prompt-on-page-load pattern.
 */
async function maybeRequestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/**
 * Fire an OS-level notification when the tab is in the background. These
 * survive sonner's toast lifecycle and hardware-throttled setInterval,
 * which is the main reason in-tab toasts get missed.
 */
function fireSystemNotification(title: string, body: string, href: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // Skip when the tab is focused — the toast is enough.
  if (typeof document !== "undefined" && !document.hidden) return;

  try {
    const n = new Notification(title, {
      body,
      tag: href, // dedupes if multiple events for the same deck fire
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      window.location.href = href;
      n.close();
    };
  } catch {
    // Notification can throw on some platforms — silent fail is fine.
  }
}

interface JobResponse {
  status?: string;
  output?: Record<string, unknown> | null;
  error?: string | null;
  projectId?: string;
}

export function JobsMonitor() {
  const { status: authStatus } = useSession();
  const slots = useGenerationStore((s) => s.slots);
  const hydrate = useGenerationStore((s) => s.hydrate);
  const push = useNotificationStore((s) => s.push);
  const pathname = usePathname();
  const pathRef = useRef(pathname);

  // Keep the current pathname in a ref so the long-lived poll loop reads the
  // latest value without re-running on every navigation. Without this, every
  // route change would tear down + re-create the polling interval.
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    // Don't poll when the user isn't signed in (avoids 401 spam).
    if (authStatus !== "authenticated") return;

    // Collect projectIds with active in-flight slots.
    const activeEntries = Object.entries(slots).filter(([, s]) => s.isGenerating && s.jobId);
    if (activeEntries.length === 0) return;

    // Lazy-request OS notification permission as soon as we actually have
    // an in-flight job. Users grant exactly when it's relevant.
    void maybeRequestNotificationPermission();

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;

      for (const [projectId, slot] of activeEntries) {
        if (!slot.jobId) continue;
        try {
          const r = await fetch(`/api/jobs/${slot.jobId}`);
          // 404 ⇒ the job (or its project) was deleted server-side while
          // localStorage still holds an in-flight slot. Without this branch
          // we'd poll the same dead jobId every 6s forever, spamming the
          // console with 404s. Reset the slot so the dashboard / project
          // page no longer thinks something's generating.
          if (r.status === 404) {
            useGenerationStore.getState().reset(projectId);
            continue;
          }
          // Other transient errors (network blip, 5xx) — try again next tick
          // but stop spamming localStorage with stale jobs that have been
          // stuck "generating" for >2 hours.
          if (!r.ok) {
            const stuckMs = slot.lastEventAt ? Date.now() - slot.lastEventAt : Infinity;
            if (stuckMs > 2 * 60 * 60 * 1000) {
              useGenerationStore.getState().reset(projectId);
            }
            continue;
          }
          const j = (await r.json()) as JobResponse;
          if (cancelled) return;

          if (j.status === "COMPLETED") {
            const presentationId =
              (j.output?.presentationId as string) || (j.output?.id as string) || null;
            // 1. Fold into generation store so the per-project UI knows.
            hydrate(projectId, {
              isGenerating: false,
              phase: "complete",
              progress: 1,
              presentationId,
              message: "Presentation ready!",
              lastEventAt: Date.now(),
            });
            // 2. Persist a notification (dedup'd by jobId+kind).
            const inserted = push({
              kind: "deck_ready",
              projectId,
              jobId: slot.jobId,
              title: "Presentation ready",
              body: "Your deck just finished generating.",
              href: `/projects/${projectId}`,
            });
            // 3. Fire a toast only when user is NOT viewing that project.
            const onProjectPage = (pathRef.current || "").startsWith(
              `/projects/${projectId}`,
            );
            if (inserted && !onProjectPage) {
              const href = `/projects/${projectId}`;
              toast.success("Presentation ready", {
                description: "Click to open the deck.",
                icon: <CheckCircle2 className="h-4 w-4" />,
                duration: TOAST_DURATION_MS,
                action: {
                  label: "Open",
                  onClick: () => {
                    window.location.href = href;
                  },
                },
              });
              // OS-level alert when the tab is in the background — only way
              // to actually reach the user when they've switched apps.
              fireSystemNotification(
                "Preso — Presentation ready",
                "Your deck just finished generating.",
                href,
              );
            }
          } else if (j.status === "FAILED") {
            hydrate(projectId, {
              isGenerating: false,
              phase: "failed",
              error: j.error || "Generation failed",
              lastEventAt: Date.now(),
            });
            const inserted = push({
              kind: "deck_failed",
              projectId,
              jobId: slot.jobId,
              title: "Generation failed",
              body: j.error || "The deck couldn't be generated.",
              href: `/projects/${projectId}`,
            });
            const onProjectPage = (pathRef.current || "").startsWith(
              `/projects/${projectId}`,
            );
            if (inserted && !onProjectPage) {
              const href = `/projects/${projectId}`;
              toast.error("Generation failed", {
                description: j.error?.slice(0, 100) || "Open the project to retry.",
                icon: <AlertCircle className="h-4 w-4" />,
                duration: TOAST_DURATION_MS,
                action: {
                  label: "Open",
                  onClick: () => {
                    window.location.href = href;
                  },
                },
              });
              fireSystemNotification(
                "Preso — Generation failed",
                j.error?.slice(0, 120) || "Open the project to retry.",
                href,
              );
            }
          }
        } catch {
          // Network blip — try again next tick.
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // We intentionally re-run when the set of active jobIds changes (not on
    // every slot field change). Stringifying the active jobIds gives that
    // dependency without re-creating the poll loop on irrelevant updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authStatus,
    Object.entries(slots)
      .filter(([, s]) => s.isGenerating && s.jobId)
      .map(([pid, s]) => `${pid}:${s.jobId}`)
      .join("|"),
  ]);

  return null;
}
