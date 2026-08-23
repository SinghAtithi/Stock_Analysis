import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Pricing — NIFTY//TERM",
  description:
    "What stays free forever, what Pro adds, and why the free tier is not a trial.",
};

const FREE = [
  "Full NIFTY 50 terminal — charts, depth, key stats",
  "All public read APIs (signals, breadth, screener)",
  "Every jury-ranked strategy score, updated daily",
  "Watchlists, alerts, backtest evidence strip",
];

const PRO = [
  "Higher compute caps: 100 backtests/day (vs 3)",
  "Up to 50 active alerts (vs 5)",
  "Priority upstream budget when queues form",
  "Early access to nifty500 factor coverage",
];

/* Mirrors lib/tiers.ts TIER_LIMITS — keep in sync until billing lands
   and this page reads live limits from an API instead. */

export default function PricingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader subtitle="Pricing" subtitleClassName="ml-1 hidden text-xs font-normal text-muted sm:inline" />
      <main id="main-content" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-paper">Pricing</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        NIFTY//TERM is a research terminal, not a trading product. The free
        tier is the product — Pro only raises compute ceilings for heavy users.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="plan-free" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 id="plan-free" className="text-sm font-semibold tracking-wide text-paper">Free</h2>
          <p className="mt-1 font-mono text-2xl font-semibold text-paper">₹0</p>
          <p className="mt-1 text-xs text-muted">Forever. Not a trial.</p>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
            {FREE.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden className="text-up">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="plan-pro" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 id="plan-pro" className="text-sm font-semibold tracking-wide text-paper">Pro</h2>
          <p className="mt-1 font-mono text-2xl font-semibold text-paper">
            Coming later
          </p>
          <p className="mt-1 text-xs text-muted">Not purchasable yet — granted manually during research preview.</p>
          <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
            {PRO.map((f) => (
              <li key={f} className="flex gap-2">
                <span aria-hidden className="text-up">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-6 rounded-xl border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-muted">
        Caps currently enforced per device; anonymous traffic is keyed by IP.
        Billing is not wired — see{" "}
        <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
          disclaimer
        </Link>{" "}
        for what this tool is and is not.
      </p>
      </main>
    </div>
  );
}
