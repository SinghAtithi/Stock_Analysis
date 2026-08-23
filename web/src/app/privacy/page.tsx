import type { Metadata } from "next";
import Link from "next/link";
import "../disclaimer/legal.css";

export const metadata: Metadata = {
  title: "Privacy — NIFTY//TERM",
  description: "No accounts, no tracking: what NIFTY//TERM stores.",
};

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "01 — NO ACCOUNTS, NO PII",
    p: [
      "NIFTY//TERM does not require accounts, email addresses, or any personal information. There is no sign-up, no login, and no profile.",
    ],
  },
  {
    h: "02 — LOCAL STORAGE ONLY",
    p: [
      "Your watchlist lives in your browser's localStorage under the key niftyterm.watchlist. It never leaves your device. Clearing your browser data removes it; you can also export and import it as JSON from the watchlist panel.",
    ],
  },
  {
    h: "03 — NO ANALYTICS, NO TRACKING",
    p: [
      "The site ships no analytics, advertising, or third-party tracking scripts. Requests to data endpoints (Yahoo, NSE, etc.) happen server-side and contain no personal identifiers beyond your IP address, which those providers may log.",
    ],
  },
  {
    h: "04 — EXTERNAL LINKS",
    p: [
      "Charts and data attribute third-party providers whose own privacy policies apply to their services.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header className="legal-head">
        <Link href="/" className="legal-wordmark">
          <span className="inline-block h-2 w-2 bg-up" aria-hidden />
          NIFTY<span className="text-faint">{"//"}</span>TERM
          <span className="text-faint"> PRIVACY</span>
        </Link>
        <Link href="/" className="legal-back">
          ← TERMINAL
        </Link>
      </header>
      <div className="legal-body">
        <h1 className="legal-h1">PRIVACY</h1>
        <p className="legal-lede">NOTHING LEAVES YOUR DEVICE EXCEPT DATA REQUESTS.</p>
        {SECTIONS.map((s) => (
          <section key={s.h} className="legal-section">
            <h2 className="legal-h2">{s.h}</h2>
            {s.p.map((para) => (
              <p key={para.slice(0, 32)} className="legal-p">
                {para}
              </p>
            ))}
          </section>
        ))}
        <footer className="legal-foot">
          <Link href="/disclaimer" className="legal-link">
            DISCLAIMER
          </Link>
          <Link href="/terms" className="legal-link">
            TERMS
          </Link>
          <span>LAST UPDATED · 2026-08-16</span>
        </footer>
      </div>
    </main>
  );
}
