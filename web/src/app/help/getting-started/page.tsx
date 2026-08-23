import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Getting started — NIFTY Help",
  description: "Your first chart, watchlist, screen, backtest and alert on NIFTY.",
};

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 font-mono text-[11px] font-medium text-muted"
      >
        {n}
      </span>
      <div>
        <h2 className="text-sm font-semibold text-paper">{title}</h2>
        <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

export default function GettingStartedPage() {
  return (
    <>
      <p className="text-xs font-medium tracking-wide text-faint">
        <Link href="/help" className="hover:text-muted">Help</Link> · Getting started
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-paper sm:text-2xl">
        Getting started
      </h1>
      <ol className="mt-6 flex flex-col gap-5">
        <Step n="1" title="Open your first chart">
          The terminal loads with a default index chart. Type{" "}
          <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[11px]">/</kbd>{" "}
          to search any NSE/BSE symbol and press Enter. Switch ranges with the chips or keys{" "}
          <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[11px]">1–8</kbd>.
        </Step>
        <Step n="2" title="Build a watchlist">
          Press the star on a company page or next to the search result to save a
          symbol. Rows show live price, day change and an intraday sparkline. Step
          through them with{" "}
          <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[11px]">J</kbd>{" "}
          /{" "}
          <kbd className="rounded border border-line bg-panel-2 px-1 py-0.5 font-mono text-[11px]">K</kbd>.{" "}
          Removed a row by accident? You get a 5-second undo.
        </Step>
        <Step n="3" title="Screen strategies">
          The <Link href="/screener" className="underline decoration-line underline-offset-2 hover:text-muted">screener</Link>{" "}
          ranks today&apos;s universe per strategy. Click a row to open its chart; use
          &quot;Save view&quot; to keep a strategy + sort combination.
        </Step>
        <Step n="4" title="Backtest before you trust it">
          The <Link href="/backtest" className="underline decoration-line underline-offset-2 hover:text-muted">backtester</Link>{" "}
          replays a strategy over split-adjusted daily candles and reports CAGR,
          Sharpe and max drawdown against a benchmark. Free plans run 3 backtests
          per day.
        </Step>
        <Step n="5" title="Let alerts watch for you">
          The bell opens the alert center: price crosses, plus membership alerts
          that fire when a symbol enters or leaves a strategy&apos;s top ranks.
        </Step>
      </ol>
      <p className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-faint">
        Quotes are delayed at least 15 minutes and nothing here is investment
        advice — see the disclaimer linked in every footer.
      </p>
    </>
  );
}
