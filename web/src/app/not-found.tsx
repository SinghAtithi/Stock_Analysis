"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function NotFound() {
  useEffect(() => {
    document.title = "404 — NIFTY//TERM";
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6">
      <h1 className="font-mono text-[64px] font-bold leading-none tracking-tight text-paper">
        404
        <span className="cursor-blink text-faint">_</span>
      </h1>
      <p className="text-sm text-muted">Segment not found on this exchange.</p>
      <Link
        href="/"
        className="rounded-full border border-line bg-surface px-4 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-panel-2 hover:text-paper"
      >
        Return to terminal
      </Link>
    </main>
  );
}
