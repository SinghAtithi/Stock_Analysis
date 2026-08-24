"use client";

/* TASK-1379 — root crash screen. Replaces the root layout when active, so it
 * must render its own <html>/<body> and cannot rely on globals.css: the
 * canvas/paper tokens are inlined here for both themes. This Next version
 * passes `retry` (not reset). */

import { useEffect } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[root crash]", error);
    document.title = "Fault — NIFTY//TERM";
  }, [error]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        retry();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [retry]);

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('nifty-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`,
          }}
        />
        <style>{`:root{--g-canvas:#fcfcf9;--g-paper:#111214;--g-muted:#626870;--g-faint:#696f77;--g-line:#ece9e3;--g-surface:#ffffff;--g-panel2:#f3f2ef}
html.dark{--g-canvas:#0a0a0b;--g-paper:#ecebe8;--g-muted:#a8adb2;--g-faint:#858b91;--g-line:#25272b;--g-surface:#141518;--g-panel2:#1c1e21}
html,body{min-height:100%}
body{margin:0;display:flex;align-items:center;justify-content:center;background:var(--g-canvas);color:var(--g-paper);font-family:var(--font-sans),system-ui,sans-serif}
.g-card{width:min(28rem,calc(100vw - 3rem));border:1px solid var(--g-line);background:var(--g-surface);border-radius:16px;padding:1.5rem;box-shadow:0 4px 16px rgb(17 18 20 / .08)}
.g-glyph{margin:0;font-family:var(--font-mono),monospace;font-size:48px;font-weight:700;line-height:1;letter-spacing:-.02em;color:var(--g-paper);text-align:center}
.g-title{margin:0;font-size:.875rem;font-weight:600;letter-spacing:-.01em}
.g-copy{margin:.75rem 0 0;font-size:13px;line-height:1.6;color:var(--g-muted)}
.g-ref{margin:.75rem 0 0;font-family:var(--font-mono),monospace;font-size:11px;color:var(--g-faint);word-break:break-all}
.g-row{margin-top:1.25rem;display:flex;align-items:center;gap:.75rem}
.g-retry{border:0;border-radius:9999px;background:var(--g-paper);color:var(--g-canvas);padding:.375rem 1rem;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer}
.g-retry:hover{opacity:.85}
.g-home{border-radius:9999px;border:1px solid var(--g-line);background:var(--g-surface);color:var(--g-muted);padding:.375rem 1rem;font-size:12px;font-weight:500;font-family:inherit;text-decoration:none}
@media (prefers-reduced-motion: no-preference){.g-retry,.g-home,.g-card{transition:opacity .15s ease-out,background-color .15s ease-out}}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`}</style>
      </head>
      <body>
        <main>
          <p role="status" aria-live="polite" className="sr-only">
            The terminal hit a fault. Press R or choose Retry to try again.
          </p>
          <h1 className="g-glyph">
            ERR<span style={{ color: "var(--g-faint)" }}>_</span>
          </h1>
          <div className="g-card" style={{ marginTop: "1.5rem" }}>
            <h2 className="g-title">The terminal hit a fault</h2>
            <p className="g-copy">
              A root-level error interrupted the session. Retry to recover;
              if it repeats, reopen the terminal fresh.
            </p>
            {error.digest ? (
              <p className="g-ref">ref {error.digest}</p>
            ) : null}
            <div className="g-row">
              <button type="button" className="g-retry" onClick={() => retry()}>
                Retry
                <span
                  style={{ marginLeft: "6px", opacity: 0.6, fontSize: "10px" }}
                >
                  R
                </span>
              </button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- root crash: force a full document load; the router itself may be dead */}
              <a className="g-home" href="/">
                Return to terminal
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
