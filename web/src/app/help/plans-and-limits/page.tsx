import type { Metadata } from "next";
import Link from "next/link";
import { TIER_LIMITS } from "@/lib/tiers";

export const metadata: Metadata = {
  title: "Plans & limits — NIFTY Help",
  description: "Free vs Pro limits for daily backtests and active alerts on NIFTY.",
};

function LimitTable({ tier, limits }: { tier: string; limits: Record<string, number> }) {
  const rows: { key: keyof typeof limits; label: string; unit: string }[] = [
    { key: "backtestRunsPerDay", label: "Backtest runs", unit: "per rolling 24h" },
    { key: "activeAlertsMax", label: "Active alerts", unit: "at once" },
    { key: "savedMixesMax", label: "Saved strategy mixes", unit: "at once" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold capitalize text-paper">{tier} plan</h2>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-faint">
            <th scope="col" className="pb-2 font-medium">Limit</th>
            <th scope="col" className="pb-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-2 pr-4 font-sans text-muted">
                {r.label} <span className="text-faint">· {r.unit}</span>
              </td>
              <td className="py-2 text-right text-paper">
                {limits[r.key] >= 1_000_000 ? "Unlimited" : limits[r.key]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PlansAndLimitsPage() {
  return (
    <>
      <p className="text-xs font-medium tracking-wide text-faint">
        <Link href="/help" className="hover:text-muted">Help</Link> · Plans &amp; limits
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-paper sm:text-2xl">
        Plans &amp; limits
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        Compute-heavy features are capped per device so one heavy session can&apos;t
        starve everyone. Counters run on a rolling window — hitting a cap never
        loses your data, it just asks you to wait.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <LimitTable tier="free" limits={TIER_LIMITS.free} />
        <LimitTable tier="pro" limits={TIER_LIMITS.pro} />
      </div>
      <div className="mt-6 grid gap-3">
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-semibold text-paper">When you hit a limit</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The backtester tells you exactly how long until the next slot opens
            (“next slot in ~2h”) with a link to{" "}
            <Link href="/pricing" className="underline decoration-line underline-offset-2 hover:text-muted">Pricing</Link>.
            Alert caps explain how many alerts you have and let you remove one to
            make room.
          </p>
        </section>
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
          <h2 className="text-sm font-semibold text-paper">What is not metered</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Charts, screener views, breadth, company pages and help are unlimited
            on every plan.
          </p>
        </section>
      </div>
    </>
  );
}
