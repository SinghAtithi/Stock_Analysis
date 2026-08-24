"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/* TASK-848: the media-scoped theme-color metas follow the OS scheme, not the
   app toggle — rewrite their contents so mobile browser chrome tracks the
   in-app theme. Colors are the canvas tokens (#fcfcf9 light, #0a0a0b dark). */
function syncThemeColor(dark: boolean) {
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute("content", dark ? "#0a0a0b" : "#fcfcf9"));
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem("nifty-theme") as "light" | "dark" | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved ?? (prefersDark ? "dark" : "light");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate theme from storage/media
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    syncThemeColor(initial === "dark");
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("nifty-theme", next);
    syncThemeColor(next === "dark");
  };

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-paper after:absolute after:-inset-1.5 after:content-['']"
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
