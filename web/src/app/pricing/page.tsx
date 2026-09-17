import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import AnalyticsView from "@/components/AnalyticsView";
import { TIER_LIMITS } from "@/lib/tiers";

export const metadata: Metadata = {
  title: "Pricing — NIFTY//TERM",
  description:
    "What stays free forever, what Pro adds, and why the free tier is not a trial.",
};

const REPO_ISSUES = "https://github.com/SinghAtithi/Stock_Analysis/issues";

const FREE = [
  "Full NIFTY 50 terminal — charts, depth, key stats",
  "All public read APIs (signals, breadth, screener)",
  "Every jury-ranked strategy score, updated daily",
  "Watchlists, alerts, backtest evidence strip",
];

const PRO = [
  `Higher compute caps: ${TIER_LIMITS.pro.backtestRunsPerDay} backtests/day (vs ${TIER_LIMITS.free.backtestRunsPerDay})`,
  `Up to ${TIER_LIMITS.pro.activeAlertsMax} active alerts (vs ${TIER_LIMITS.free.activeAlertsMax})`,
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
      <AnalyticsView kind="pricing_view" />
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
                <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-up" />
                {f}
              </li>
            ))}
          </ul>
          <Link
            href="/"
            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent"
          >
            Continue free →
          </Link>
          <p className="mt-2 text-center text-[11px] text-faint">
            No card today — no account needed.
          </p>
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
                <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-up" />
                {f}
              </li>
            ))}
          </ul>
          <a
            href={REPO_ISSUES}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex w-full items-center justify-center rounded-full border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-surface"
          >
            Request Pro access ↗
          </a>
          <p className="mt-2 text-center text-[11px] text-faint">
            No card today — opens a GitHub issue; include your device id.
          </p>
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

      <section aria-labelledby="pricing-faq" className="mt-10">
        <h2 id="pricing-faq" className="text-sm font-semibold tracking-wide text-paper">FAQ</h2>
        <div className="mt-3 grid gap-3">
          <details className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-medium text-paper">What does &quot;Pro preview&quot; mean?</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Pro exists in the product but billing is not wired. During the
              research preview, Pro is granted manually per device — there is
              nothing to pay and nothing auto-renews.
            </p>
          </details>
          <details className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-medium text-paper">How are the caps counted?</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Backtest slots run on a rolling 24-hour window per device; alerts
              are a concurrent cap on active alerts. Hitting a cap never deletes
              anything — it just asks you to wait or free an alert.
            </p>
          </details>
          <details className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-medium text-paper">Is the free tier going away?</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              No. The free tier is the product — Pro only raises compute ceilings
              for heavy users. Charts, screener, breadth and scores stay unlimited.
            </p>
          </details>
          <details className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <summary className="cursor-pointer text-sm font-medium text-paper">Where do these numbers come from?</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This page renders the same limits the API enforces (see{" "}
              <Link href="/help/plans-and-limits" className="underline decoration-line underline-offset-2 hover:text-muted">
                Plans &amp; limits
              </Link>{" "}
              in Help). When enforcement changes, both change together.
            </p>
          </details>
        </div>
      </section>
      </main>
    </div>
  );
}
