"use client";

import { useEffect, useState, useRef, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

interface SidebarItem {
  id: string;
  label: string;
  group?: string;
}

export function DocsClient({
  sections,
  children,
}: {
  sections: SidebarItem[];
  children: ReactNode;
}) {
  const [active, setActive] = useState<string>(sections[0]?.id || "");
  const [mobileOpen, setMobileOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Active-section tracking — highlights whichever section's heading is
  // closest to the top of the viewport. Uses IntersectionObserver instead
  // of scroll math, which keeps it cheap and correct under fast scrolls.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (observerRef.current) observerRef.current.disconnect();

    const opts: IntersectionObserverInit = {
      rootMargin: "-20% 0px -70% 0px",
      threshold: [0, 0.5, 1],
    };
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop);
      if (visible.length > 0) {
        const id = (visible[0].target as HTMLElement).id;
        if (id) setActive(id);
      }
    }, opts);
    observerRef.current = observer;
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  function jumpTo(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = 64; // sticky header height
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: "smooth" });
    setActive(id);
    setMobileOpen(false);
  }

  // Group sidebar items by their `group` label so we can render section
  // headers in the nav.
  const grouped: Array<{ group: string; items: SidebarItem[] }> = [];
  for (const s of sections) {
    if (s.group) grouped.push({ group: s.group, items: [s] });
    else if (grouped.length === 0) grouped.push({ group: "", items: [s] });
    else grouped[grouped.length - 1].items.push(s);
  }

  return (
    <main className="flex-1">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-10">
        {/* Mobile-only "On this page" toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="lg:hidden self-start rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 text-muted-foreground"
        >
          {mobileOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          On this page
        </button>

        {/* Sticky sidebar */}
        <nav
          className={
            (mobileOpen
              ? "block fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto bg-background/95 backdrop-blur-sm border-b border-border/60 px-6 py-4"
              : "hidden") +
            " lg:block lg:static lg:bg-transparent lg:border-0 lg:px-0 lg:py-0 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
          }
        >
          <ul className="space-y-1.5 text-sm">
            {grouped.map((g, gi) => (
              <li key={gi} className="mb-2">
                {g.group && (
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/60 mt-3 mb-1.5">
                    {g.group}
                  </p>
                )}
                <ul className="space-y-0.5 border-l border-border/50">
                  {g.items.map((it) => {
                    const isActive = active === it.id;
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => jumpTo(it.id)}
                          className={
                            "block w-full text-left pl-3 py-1 text-xs leading-relaxed -ml-px border-l-2 transition-colors " +
                            (isActive
                              ? "border-primary text-foreground font-medium"
                              : "border-transparent text-muted-foreground hover:text-foreground")
                          }
                        >
                          {it.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content column */}
        <article className="docs-prose min-w-0">{children}</article>
      </div>
    </main>
  );
}
