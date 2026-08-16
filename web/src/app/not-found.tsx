"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function NotFound() {
  useEffect(() => {
    document.title = "404 — NIFTY//TERM";
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-ink px-6">
      <h1 className="font-mono text-[64px] font-bold leading-none tracking-tight text-paper">
        404
        <span className="cursor-blink text-up">_</span>
      </h1>
      <p className="font-mono text-[11px] tracking-[0.3em] text-muted">
        SEGMENT NOT FOUND ON THIS EXCHANGE
      </p>
      <Link
        href="/"
        className="border border-up/40 bg-up/10 px-4 py-2 font-mono text-[11px] font-bold tracking-[0.2em] text-up transition-colors duration-100 hover:bg-up hover:text-ink"
      >
        RETURN TO TERMINAL
      </Link>
    </main>
  );
}
