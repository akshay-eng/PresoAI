"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("sf-theme") as "dark" | "light" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.className = saved;
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("sf-theme", next);
    document.documentElement.className = next;
  }

  return (
    <button
      onClick={toggle}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-colors ${className || ""}`}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
