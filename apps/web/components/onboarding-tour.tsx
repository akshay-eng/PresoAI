"use client";

import { useEffect, useState } from "react";
import { TourProvider, useTour, StepType } from "@reactour/tour";

const STORAGE_KEY = "sf_onboarded_v1";

// Dark-theme fallbacks (used before CSS vars are read)
const DARK = {
  bg: "#22252E",
  border: "#2F323D",
  fg: "#EDEBE7",
  muted: "#9194A1",
  primary: "#14B8A6",
  primaryFg: "#042F2E",
  secondary: "#2A2D38",
  dot: "#24272F",
};

type Colors = typeof DARK;

function readThemeColors(): Colors {
  if (typeof window === "undefined") return DARK;
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bg:        v("--color-card")               || DARK.bg,
    border:    v("--color-border")             || DARK.border,
    fg:        v("--color-foreground")         || DARK.fg,
    muted:     v("--color-muted-foreground")   || DARK.muted,
    primary:   v("--color-primary")            || DARK.primary,
    primaryFg: v("--color-primary-foreground") || DARK.primaryFg,
    secondary: v("--color-secondary")          || DARK.secondary,
    dot:       v("--color-muted")              || DARK.dot,
  };
}

function useTourColors(): Colors {
  const [C, setC] = useState<Colors>(DARK);

  useEffect(() => {
    setC(readThemeColors());

    // Re-read when theme class changes (light/dark toggle)
    const observer = new MutationObserver(() => setC(readThemeColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return C;
}

function dismiss() {
  localStorage.setItem(STORAGE_KEY, "1");
}

type StepData = { title: string; body: string };

const STEPS: StepData[] = [
  {
    title: "Welcome to SlideForge!",
    body: "Type your presentation idea here. Be specific — include the topic, target audience, and key points you want covered.",
  },
  {
    title: "Slide Count",
    body: "Choose how many slides you need. We recommend 8–15 for most presentations.",
  },
  {
    title: "AI Model",
    body: "Pick the AI that powers your deck. Gemini 2.5 Pro and Claude Opus produce the richest slides. Add your API key in Settings for unlimited use.",
  },
  {
    title: "Creative Mode",
    body: "Unlocks bolder layouts, dynamic visuals, and imaginative slide structures. Perfect for pitches and marketing decks.",
  },
  {
    title: "Diagrams",
    body: "When on, the AI generates charts, flow diagrams, and SmartArt-style graphics to illustrate concepts visually.",
  },
  {
    title: "AI Images",
    body: "Generates photorealistic slide backgrounds using Gemini's image model. Requires a Google API key or free-tier credits.",
  },
  {
    title: "Style Profiles",
    body: "Apply a brand style — the AI follows the palette, typography and layout patterns throughout your entire deck.",
  },
  {
    title: "You're all set!",
    body: "Hit Generate and watch SlideForge build your presentation live. Download as PPTX, PDF, or export straight to Canva.",
  },
];

const SELECTORS = [
  '[data-tour="hero-prompt"]',
  '[data-tour="slide-count"]',
  '[data-tour="model-selector"]',
  '[data-tour="creative-toggle"]',
  '[data-tour="diagrams-toggle"]',
  '[data-tour="images-toggle"]',
  '[data-tour="style-catalog"]',
  '[data-tour="generate-btn"]',
];

function StepContent({ idx }: { idx: number }) {
  const { setIsOpen, setCurrentStep, steps } = useTour();
  const C = useTourColors();
  const isLast = idx === steps.length - 1;
  const d = STEPS[idx];

  const skip = () => { dismiss(); setIsOpen(false); };
  const finish = () => { dismiss(); setIsOpen(false); };
  const next = () => setCurrentStep(idx + 1);

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* Step label */}
      <p style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", color: C.primary, marginBottom: 8,
      }}>
        Step {idx + 1} of {steps.length}
      </p>

      {/* Title */}
      <p style={{ fontSize: 15, fontWeight: 700, color: C.fg, marginBottom: 8, lineHeight: 1.3 }}>
        {d?.title}
      </p>

      {/* Body */}
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.65, marginBottom: 20 }}>
        {d?.body}
      </p>

      {/* Dot progress */}
      <div style={{ display: "flex", gap: 5, marginBottom: 20, alignItems: "center" }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === idx ? 20 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === idx ? C.primary : C.dot,
              transition: "all 0.25s ease",
            }}
          />
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: C.border, marginBottom: 16 }} />

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={skip}
          style={{
            fontSize: 12, color: C.muted, background: "none",
            border: "none", cursor: "pointer", padding: "4px 0",
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.color = C.fg; }}
          onMouseLeave={(e) => { (e.currentTarget).style.color = C.muted; }}
        >
          Skip tour
        </button>

        <button
          onClick={isLast ? finish : next}
          style={{
            fontSize: 13, fontWeight: 600, color: C.primaryFg,
            background: C.primary, border: "none", cursor: "pointer",
            padding: "8px 20px", borderRadius: 8, letterSpacing: "0.01em",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget).style.opacity = "0.88"; }}
          onMouseLeave={(e) => { (e.currentTarget).style.opacity = "1"; }}
        >
          {isLast ? "Let's go!" : "Next →"}
        </button>
      </div>
    </div>
  );
}

const tourSteps: StepType[] = STEPS.map((_, i) => ({
  selector: SELECTORS[i]!,
  content: () => <StepContent idx={i} />,
}));

function TourAutoStart() {
  const { setIsOpen } = useTour();
  useEffect(() => {
    const t = setTimeout(() => setIsOpen(true), 700);
    return () => clearTimeout(t);
  }, [setIsOpen]);
  return null;
}

function TourProviderWithTheme() {
  const C = useTourColors();

  return (
    <TourProvider
      steps={tourSteps}
      showNavigation={false}
      showBadge={false}
      showDots={false}
      showCloseButton={false}
      disableInteraction={false}
      padding={{ mask: 8, popover: [12, 16] }}
      styles={{
        popover: (base) => ({
          ...base,
          backgroundColor: C.bg,
          borderRadius: 14,
          border: `1px solid ${C.border}`,
          boxShadow: `0 0 0 1px ${C.border}, 0 24px 64px rgba(0,0,0,0.6)`,
          color: C.fg,
          padding: "22px 24px 20px",
          maxWidth: 340,
          minWidth: 300,
        }),
        maskWrapper: (base) => ({
          ...base,
          opacity: 1,
        }),
        maskArea: (base) => ({
          ...base,
          rx: 10,
        }),
        svgWrapper: (base) => ({
          ...base,
          opacity: 0.82,
        }),
      }}
      onClickClose={() => { dismiss(); }}
      onClickMask={() => { /* don't close on overlay click */ }}
      afterOpen={() => { dismiss(); }}
    >
      <TourAutoStart />
    </TourProvider>
  );
}

export function OnboardingTour({ isFirstVisit }: { isFirstVisit: boolean }) {
  if (!isFirstVisit) return null;
  return <TourProviderWithTheme />;
}

/** Returns true only on the very first dashboard visit */
export function useIsFirstVisit(): boolean {
  const [isFirst, setIsFirst] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setIsFirst(true);
      // Don't set the key yet — let afterOpen/skip/finish do it
    }
  }, []);

  return isFirst;
}
