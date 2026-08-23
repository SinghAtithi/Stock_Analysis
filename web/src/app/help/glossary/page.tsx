import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Glossary — NIFTY Help",
  description: "CAGR, Sharpe, max drawdown, universes and other NIFTY terms explained.",
};

const TERMS: { t: string; d: string }[] = [
  { t: "Score (0–100)", d: "A symbol's percentile within today's universe for one strategy. 91 ≈ top decile today. Not a forecast." },
  { t: "Jury rank", d: "A strategy's consensus position in the 190-strategy ranking produced by six independent model jurors." },
  { t: "Edge score", d: "Mean juror rating (1–10) of a strategy's expected edge. A prior on the family, not a trade promise." },
  { t: "Universe", d: "The symbol set a strategy scores against — NIFTY 50 or NIFTY 500 members as of the snapshot." },
  { t: "Signal snapshot", d: "A point-in-time capture of a strategy's ranked output. Backtests only see snapshots dated before each rebalance." },
  { t: "CAGR", d: "Compound annual growth rate: the constant yearly return that would produce the same final equity. Best for multi-year comparisons." },
  { t: "Sharpe ratio", d: "Return above the risk-free rate per unit of volatility (annualised). Higher is smoother; below ~0.5 is weak for daily data." },
  { t: "Max drawdown (maxDD)", d: "Worst peak-to-trough loss of the equity curve, shown positive. A 23% maxDD means a buyer at the peak once sat 23% underwater." },
  { t: "Turnover", d: "How much of the portfolio was traded across rebalances. Higher turnover implies more cost sensitivity." },
  { t: "Rebalance", d: "Scheduled re-picking of the portfolio (monthly here) from the latest signal snapshot." },
  { t: "Membership alert", d: "Fires when a symbol enters or exits a strategy's top-N ranks, instead of at a price level." },
  { t: "Breadth", d: "Aggregate internals — advancing vs declining issues, new highs/lows and FII/DII flows — read for regime, not picks." },
  { t: "Split adjustment", d: "Back-adjusting history so a corporate split doesn't look like a crash; all backtest candles are adjusted." },
  { t: "Delayed quote", d: "Exchange-permitted price at least 15 minutes old. See Data & delays." },
];

export default function GlossaryPage() {
  return (
    <>
      <p className="text-xs font-medium tracking-wide text-faint">
        <Link href="/help" className="hover:text-muted">Help</Link> · Glossary
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-paper sm:text-2xl">Glossary</h1>
      <dl className="mt-6 grid gap-3">
        {TERMS.map((x) => (
          <div key={x.t} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
            <dt className="text-sm font-semibold text-paper">{x.t}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">{x.d}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-sm leading-relaxed text-muted">
        Missing a term?{" "}
        <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
          Read the disclaimer
        </Link>{" "}
        and remember none of this is investment advice.
      </p>
    </>
  );
}
