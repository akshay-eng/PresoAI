"use client";

import { cn } from "@/lib/utils";

interface PresoLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

// Warm teal-to-coral gradient matching the app's primary + accent
const gradient = "linear-gradient(135deg, #14B8A6 0%, #F97066 100%)";

export function PresoLogo({ size = "md", className }: PresoLogoProps) {
  const sizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
    xl: "text-4xl",
  };

  return (
    <span
      className={cn(sizes[size], "select-none", className)}
      style={{
        fontFamily: "var(--font-logo), 'Pacifico', cursive",
        background: gradient,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      preso.ai
    </span>
  );
}

export function PresoLogoIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-[17px] select-none", className)}
      style={{
        fontFamily: "var(--font-logo), 'Pacifico', cursive",
        background: gradient,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      preso.ai
    </span>
  );
}
