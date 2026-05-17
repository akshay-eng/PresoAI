"use client";

import { useEffect, useState } from "react";
import { TourProvider, useTour, StepType } from "@reactour/tour";

const STORAGE_KEY = "sf_onboarded_v1";

function dismiss() {
  localStorage.setItem(STORAGE_KEY, "1");
}

type StepContent = {
  title: string;
  body: string;
};

const STEP_DATA: StepContent[] = [
  {
    title: "Welcome to SlideForge!",
    body: "Describe the presentation you want to create here. Be specific — include the topic, audience, and key points.",
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
    body: "Enables bolder layouts, more dynamic visuals, and imaginative slide structures. Great for pitches and marketing decks.",
  },
  {
    title: "Diagrams",
    body: "When enabled, the AI generates charts, flow diagrams, and SmartArt-style graphics to illustrate concepts visually.",
  },
  {
    title: "AI Images",
    body: "Generates photorealistic background images using Gemini's image model. Requires a Google API key or free-tier credits.",
  },
  {
    title: "Style Profiles",
    body: "Browse curated design styles — from corporate clean to bold & modern. The AI follows the selected palette and typography throughout your deck.",
  },
  {
    title: "You're all set!",
    body: "Hit Generate and watch SlideForge build your presentation live. Download as PPTX, PDF, or export directly to Canva.",
  },
];

// Custom step content rendered inside the popover
function StepContent({ stepIndex }: { stepIndex: number }) {
  const { setIsOpen, setCurrentStep, steps } = useTour();
  const isLast = stepIndex === steps.length - 1;
  const data = STEP_DATA[stepIndex];

  function skip() {
    dismiss();
    setIsOpen(false);
  }

  function finish() {
    dismiss();
    setIsOpen(false);
  }

  function next() {
    setCurrentStep(stepIndex + 1);
  }

  return (
    <div style={{ fontFamily: "inherit" }}>
      {/* Step counter */}
      <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Step {stepIndex + 1} of {steps.length}
      </p>

      {/* Title */}
      <p style={{ fontSize: 15, fontWeight: 600, color: "#f9fafb", marginBottom: 8 }}>
        {data?.title}
      </p>

      {/* Body */}
      <p style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
        {data?.body}
      </p>

      {/* Dot progress */}
      <div style={{ display: "flex", gap: 5, marginTop: 16, marginBottom: 16 }}>
        {steps.map((_, i) => (
          <div
            key={i}
            style={{
              width: i === stepIndex ? 18 : 6,
              height: 6,
              borderRadius: 3,
              background: i === stepIndex ? "#6366f1" : "#374151",
              transition: "all 0.2s",
            }}
          />
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Skip — always visible */}
        <button
          onClick={skip}
          style={{
            fontSize: 12,
            color: "#6b7280",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 0",
            textDecoration: "underline",
            textDecorationColor: "transparent",
          }}
          onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.color = "#9ca3af"; }}
          onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.color = "#6b7280"; }}
        >
          Skip tour
        </button>

        {isLast ? (
          <button
            onClick={finish}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#ffffff",
              background: "#6366f1",
              border: "none",
              cursor: "pointer",
              padding: "7px 20px",
              borderRadius: 7,
            }}
          >
            Let&apos;s go!
          </button>
        ) : (
          <button
            onClick={next}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#ffffff",
              background: "#6366f1",
              border: "none",
              cursor: "pointer",
              padding: "7px 20px",
              borderRadius: 7,
            }}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

const tourSteps: StepType[] = STEP_DATA.map((_, i) => ({
  selector: [
    '[data-tour="hero-prompt"]',
    '[data-tour="slide-count"]',
    '[data-tour="model-selector"]',
    '[data-tour="creative-toggle"]',
    '[data-tour="diagrams-toggle"]',
    '[data-tour="images-toggle"]',
    '[data-tour="style-catalog"]',
    '[data-tour="generate-btn"]',
  ][i]!,
  content: () => <StepContent stepIndex={i} />,
}));

function TourAutoStart() {
  const { setIsOpen } = useTour();
  useEffect(() => {
    const t = setTimeout(() => setIsOpen(true), 600);
    return () => clearTimeout(t);
  }, [setIsOpen]);
  return null;
}

interface OnboardingTourProps {
  isFirstVisit: boolean;
}

export function OnboardingTour({ isFirstVisit }: OnboardingTourProps) {
  if (!isFirstVisit) return null;

  return (
    <TourProvider
      steps={tourSteps}
      showNavigation={false}
      showBadge={false}
      showDots={false}
      showCloseButton={false}
      disableInteraction={false}
      styles={{
        popover: (base) => ({
          ...base,
          backgroundColor: "#111113",
          borderRadius: 12,
          border: "1px solid #1f2937",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)",
          color: "#f9fafb",
          padding: "20px 22px 18px",
          maxWidth: 340,
          minWidth: 300,
        }),
        maskWrapper: (base) => ({
          ...base,
          opacity: 1,
        }),
        maskArea: (base) => ({
          ...base,
          rx: 8,
        }),
        // The SVG mask fills — use a very dark overlay
        svgWrapper: (base) => ({
          ...base,
          opacity: 0.85,
        }),
      }}
      padding={{ mask: 6, popover: [10, 14] }}
      onClickClose={() => {
        dismiss();
      }}
      onClickMask={() => {
        // Don't close on mask click — user must use Skip or Next
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
