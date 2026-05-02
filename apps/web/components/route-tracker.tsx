"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Fires a fire-and-forget POST to /api/track/view on every client-side
 * navigation. Skips admin pages (no point tracking yourself), tracking
 * itself, and rapid duplicates.
 */
export function RouteTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<{ path: string; ts: number } | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (pathname.startsWith("/admin")) return;
    if (pathname.startsWith("/api/")) return;

    // Dedup: don't fire twice for the same path within 2s (StrictMode etc.)
    const now = Date.now();
    if (
      lastTracked.current &&
      lastTracked.current.path === pathname &&
      now - lastTracked.current.ts < 2000
    ) {
      return;
    }
    lastTracked.current = { path: pathname, ts: now };

    const payload = JSON.stringify({
      path: pathname,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
    });

    // Prefer sendBeacon when available — survives unloads and is non-blocking.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/track/view", blob);
      return;
    }

    fetch("/api/track/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => { /* swallow */ });
  }, [pathname]);

  return null;
}
