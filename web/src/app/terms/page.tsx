import type { Metadata } from "next";
import Link from "next/link";
import "../disclaimer/legal.css";

export const metadata: Metadata = {
  title: "Terms — NIFTY//TERM",
  description: "Terms of use for NIFTY//TERM.",
};

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "01 — USE OF THE SERVICE",
    p: [
      "NIFTY//TERM is provided free of charge as a research and education tool for Indian equity markets. You may use it for personal, non-commercial purposes.",
    ],
  },
  {
    h: "02 — NO WARRANTY",
    p: [
      "The service is provided 'as is' without warranties of any kind, express or implied, including accuracy, completeness, availability, or fitness for a particular purpose.",
    ],
  },
  {
    h: "03 — LIMITATION OF LIABILITY",
    p: [
      "To the maximum extent permitted by law, the maintainers shall not be liable for any direct, indirect, incidental, or consequential damages arising from use of this service.",
    ],
  },
  {
    h: "04 — THIRD-PARTY DATA",
    p: [
      "Market data and signals derive from third-party public sources. Providers may change, restrict, or discontinue access at any time. The service may become unavailable without notice.",
    ],
  },
  {
    h: "05 — CHANGES",
    p: [
      "These terms may be updated at any time. Continued use of the service constitutes acceptance of the current terms.",
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-head">
        <Link href="/" className="legal-wordmark">
          <span className="inline-block h-2 w-2 bg-up" aria-hidden />
          NIFTY<span className="text-faint">{"//"}</span>TERM
          <span className="text-faint"> TERMS</span>
        </Link>
        <Link href="/" className="legal-back">
          ← TERMINAL
        </Link>
      </header>
      <div className="legal-body">
        <h1 className="legal-h1">TERMS</h1>
        <p className="legal-lede">CONDITIONS OF USE · FREE RESEARCH TOOL</p>
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
          <Link href="/privacy" className="legal-link">
            PRIVACY
          </Link>
          <span>LAST UPDATED · 2026-08-16</span>
        </footer>
      </div>
    </main>
  );
}
