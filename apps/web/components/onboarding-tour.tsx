"use client";

import { useEffect, useState } from "react";
import { TourProvider, useTour, StepType } from "@reactour/tour";

const STORAGE_KEY = "sf_onboarded_v1";

const tourSteps: StepType[] = [
  {
    selector: '[data-tour="hero-prompt"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Welcome to SlideForge!</p>
        <p className="text-sm text-muted-foreground">
          Describe the presentation you want to create here. Be specific — include the topic, audience, and any key points you want covered.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="slide-count"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Slide Count</p>
        <p className="text-sm text-muted-foreground">
          Choose how many slides you need. We recommend 8–15 for most presentations.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="model-selector"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">AI Model</p>
        <p className="text-sm text-muted-foreground">
          Pick the AI model that powers your deck. Gemini 2.5 Pro and Claude Opus produce the richest content. Bring your own API key in Settings for unlimited use.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="creative-toggle"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Creative Mode</p>
        <p className="text-sm text-muted-foreground">
          Enables bolder layouts, more dynamic visuals, and imaginative slide structures. Great for pitches and marketing decks.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="diagrams-toggle"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Diagrams</p>
        <p className="text-sm text-muted-foreground">
          When enabled, the AI will generate charts, flow diagrams, and SmartArt-style graphics to illustrate concepts visually.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="images-toggle"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">AI Images</p>
        <p className="text-sm text-muted-foreground">
          Generates photorealistic background images using Gemini&apos;s image model. Requires a Google API key or free-tier credits.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="style-catalog"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">Style Profiles</p>
        <p className="text-sm text-muted-foreground">
          Browse curated design styles — from corporate clean to bold & modern. The AI follows the selected palette and typography throughout your deck.
        </p>
      </div>
    ),
  },
  {
    selector: '[data-tour="generate-btn"]',
    content: (
      <div className="space-y-2">
        <p className="font-semibold text-sm">You&apos;re ready!</p>
        <p className="text-sm text-muted-foreground">
          Hit Generate and watch SlideForge build your presentation in real time. Once done, download as PPTX, PDF, or export directly to Canva.
        </p>
      </div>
    ),
  },
];

function TourAutoStart() {
  const { setIsOpen } = useTour();

  useEffect(() => {
    // Small delay so the dashboard fully renders before the tour kicks off
    const t = setTimeout(() => setIsOpen(true), 800);
    return () => clearTimeout(t);
  }, [setIsOpen]);

  return null;
}

interface OnboardingTourProps {
  /** Whether this is the user's first visit (tracked by parent via localStorage) */
  isFirstVisit: boolean;
}

export function OnboardingTour({ isFirstVisit }: OnboardingTourProps) {
  if (!isFirstVisit) return null;

  return (
    <TourProvider
      steps={tourSteps}
      styles={{
        popover: (base) => ({
          ...base,
          backgroundColor: "hsl(var(--background))",
          borderRadius: "12px",
          border: "1px solid hsl(var(--border))",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          color: "hsl(var(--foreground))",
          padding: "20px",
          maxWidth: "320px",
        }),
        dot: (base, state) => ({
          ...base,
          background: state?.current ? "hsl(var(--primary))" : "hsl(var(--muted))",
        }),
        badge: (base) => ({
          ...base,
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
        }),
        controls: (base) => ({
          ...base,
          marginTop: "16px",
        }),
        button: (base) => ({
          ...base,
          background: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
          borderRadius: "6px",
          padding: "6px 16px",
          fontSize: "13px",
          fontWeight: 500,
          cursor: "pointer",
        }),
        close: (base) => ({
          ...base,
          color: "hsl(var(--muted-foreground))",
          top: "12px",
          right: "12px",
        }),
        maskWrapper: (base) => ({
          ...base,
          opacity: 0.6,
        }),
        maskArea: (base) => ({
          ...base,
          rx: 6,
        }),
      }}
      showNavigation
      showBadge
      showDots
      showCloseButton
      disableInteraction={false}
      afterOpen={() => {
        localStorage.setItem(STORAGE_KEY, "1");
      }}
      onClickClose={() => {
        localStorage.setItem(STORAGE_KEY, "1");
      }}
      onClickMask={() => {
        localStorage.setItem(STORAGE_KEY, "1");
      }}
    >
      <TourAutoStart />
    </TourProvider>
  );
}

/** Hook: returns true on the very first dashboard visit */
export function useIsFirstVisit(): boolean {
  const [isFirst, setIsFirst] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setIsFirst(true);
    }
  }, []);

  return isFirst;
}
