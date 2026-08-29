"use client";

import { useEffect, useState } from "react";
import { Contrast, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "contrast";

const CYCLE: Theme[] = ["light", "dark", "contrast"];

/* TASK-848: the media-scoped theme-color metas follow the OS scheme, not the
   app toggle — rewrite their contents so mobile browser chrome tracks the
   in-app theme. Colors are the canvas tokens (#fcfcf9 light, #0a0a0b dark,
   #ffffff contrast). */
function syncThemeColor(theme: Theme) {
  const canvas = theme === "dark" ? "#0a0a0b" : theme === "contrast" ? "#ffffff" : "#fcfcf9";
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", canvas));
}

function applyClass(theme: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", theme === "dark");
  el.classList.toggle("contrast", theme === "contrast");
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    /* TASK-366: 'contrast' persists in the same key the bootstrap reads; the
       bootstrap only applies .dark pre-paint, so contrast paints light first
       then lands post-hydration here (one-frame flash, accepted tradeoff). */
    const saved = localStorage.getItem("nifty-theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved ?? (prefersDark ? "dark" : "light");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate theme from storage/media
    setTheme(initial);
    applyClass(initial);
    syncThemeColor(initial);
  }, []);

  const toggle = () => {
    const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length];
    setTheme(next);
    applyClass(next);
    localStorage.setItem("nifty-theme", next);
    syncThemeColor(next);
  };

  const labels: Record<Theme, { next: string; icon: "moon" | "sun" | "contrast" }> = {
    light: { next: "dark", icon: "moon" },
    dark: { next: "contrast", icon: "sun" },
    contrast: { next: "light", icon: "contrast" },
  };
  const { next, icon } = labels[theme];

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      aria-pressed={theme === "contrast"}
      title={next === "light" ? "Light mode" : next === "dark" ? "Dark mode" : "High-contrast mode"}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-paper after:absolute after:-inset-1.5 after:content-['']"
    >
      {icon === "moon" ? <Moon size={14} /> : icon === "sun" ? <Sun size={14} /> : <Contrast size={14} />}
    </button>
  );
}