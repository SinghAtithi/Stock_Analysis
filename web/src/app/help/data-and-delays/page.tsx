import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Data & delays — NIFTY Help",
  description: "Where NIFTY's quotes and candles come from, delay rules, and staleness chips.",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold text-paper">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function DataAndDelaysPage() {
  return (
    <>
      <p className="text-xs font-medium tracking-wide text-faint">
        <Link href="/help" className="hover:text-muted">Help</Link> · Data &amp; delays
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-paper sm:text-2xl">
        Data &amp; delays
      </h1>
      <div className="mt-6 grid gap-3">
        <Card title="Where quotes come from">
          Intraday quotes are fetched through a vendor chain — Yahoo first, with
          Moneycontrol, Google Finance and Groww as automatic fallbacks. Daily
          candles for backtests are split-adjusted end-of-day series stored
          locally, so backtests never depend on a live vendor.
        </Card>
        <Card title="Why prices say “delayed”">
          Exchange rules put real-time NSE/BSE prices behind paid feeds. NIFTY
          shows <strong className="font-medium text-paper">at least 15-minute delayed</strong>{" "}
          quotes. Treat them as context for research, not as execution prices.
        </Card>
        <Card title="Reading the freshness chips">
          Charts can show <span className="font-mono text-[13px]">MOCK</span>,{" "}
          <span className="font-mono text-[13px]">DAILY</span> or{" "}
          <span className="font-mono text-[13px]">STALE</span> chips. DAILY means
          intraday vendors had nothing so the last close is shown; STALE means the
          newest candle is older than today&apos;s session. The company page also
          labels each section with its own freshness.
        </Card>
        <Card title="Market hours">
          The status pill in the header follows the NSE/BSE cash session (09:15–15:30 IST,
          Mon–Fri). Off-session polls pause automatically — that is why the tape
          freezes overnight instead of burning quota.
        </Card>
        <Card title="Something looks wrong">
          A missing symbol usually means it left the index or its vendor feed
          changed. A price that disagrees with your broker by more than the delay
          window is worth reporting via the feedback link in the footer.
        </Card>
      </div>
    </>
  );
}
