import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Understanding scores — NIFTY Help",
  description: "What a 0–100 score means, jury ranks, edge scores and how strategies are ranked.",
};

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold text-paper">{q}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function UnderstandingScoresPage() {
  return (
    <>
      <p className="text-xs font-medium tracking-wide text-faint">
        <Link href="/help" className="hover:text-muted">Help</Link> · Understanding scores
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-paper sm:text-2xl">
        Understanding scores
      </h1>
      <div className="mt-6 grid gap-3">
        <Q q="What does a strategy score mean?">
          Each row in the screener scores a symbol 0–100 for one strategy — it is a
          percentile within today&apos;s universe, not a forecast. A score of 91 means
          &quot;stronger than ~9 of 10 symbols on this strategy today&quot;. Scores recompute
          as new data lands; yesterday&apos;s 91 says nothing about tomorrow.
        </Q>
        <Q q="Where do the strategies come from?">
          NIFTY tracks 190 classic and factor strategies (momentum, value, quality,
          low volatility and more). Each was ranked by an independent six-model
          jury; the consensus ranking is deterministic — no model output enters the
          math, only each juror&apos;s ordering.
        </Q>
        <Q q="What is the jury rank shown next to a name?">
          &quot;Jury #1&quot; means the strategy placed first in that consensus table
          (S100, cross-sectional momentum, currently holds it). Unranked demo
          strategies are marked &quot;Unranked&quot;.
        </Q>
        <Q q="What is the edge score out of 10?">
          Jurors rated every strategy&apos;s expected edge from 1–10. The published
          number is the mean across jurors — treat it as a prior about the
          strategy family, not a promise about any single trade.
        </Q>
        <Q q="Why did a symbol&apos;s score change since morning?">
          Scores are point-in-time. They use fundamentals as reported then, prices
          as of the latest close (or delayed intraday), and today&apos;s universe
          membership. Index reshuffles or restated financials move scores without
          the strategy changing.
        </Q>
      </div>
      <p className="mt-6 text-sm leading-relaxed text-muted">
        Next:{" "}
        <Link href="/help/data-and-delays" className="underline decoration-line underline-offset-2 hover:text-muted">
          where the data comes from and how fresh it is
        </Link>
        .
      </p>
    </>
  );
}
