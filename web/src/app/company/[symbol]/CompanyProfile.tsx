"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import StarToggle from "@/components/StarToggle";
import FundamentalsPanel from "@/components/FundamentalsPanel";
import type { WatchlistEntry } from "@/lib/watchlist";
import {
  addToWatchlist,
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  isInWatchlist,
  removeFromWatchlist,
  subscribeWatchlist,
} from "@/lib/watchlist";

/* CompanyProfile — T58 client body for /company/[symbol]. Each section owns
 * its loader and degrades to a quiet empty state, so one failing endpoint
 * never blanks the page. Analyst coverage is a placeholder until the
 * analyst ingest API lands (TASK-57 mid-flight).
 * TASK-80: header gains cross-nav — Open chart deep-link (exchange resolved
 * server-side via the instruments index), watchlist star, alert bell. */

interface Props {
  symbol: string;
  /** server-resolved instruments-index entry — never a bare-symbol guess */
  resolved: WatchlistEntry;
}

interface Quote {
  symbol: string;
  name: string;
  exchange: string;
  price: number | null;
  changePct: number | null;
}

interface CorpAction {
  ts: number;
  type: string;
  ratio: number | null;
  subject: string | null;
}

const inr = (v: number) =>
  `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted">{label}</h2>
      {children}
    </section>
  );
}

function Empty({
  text,
  action,
}: {
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted shadow-sm">
      <p>{text}</p>
      {action != null && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/* TASK-600: failed sections offer recovery — quiet chip matching home's */
function RetryChip({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-muted shadow-sm transition-colors hover:border-line-strong hover:text-paper"
    >
      Retry
    </button>
  );
}

function useJson<T>(url: string): {
  data: T | null;
  failed: boolean;
  loaded: boolean;
  retry: () => void;
} {
  const [state, setState] = useState<{ forUrl: string; data: T | null } | null>(null);
  /* failure keyed to the url it happened for — one bad fetch must not poison
     other sections, and a retry clears it instead of sticking forever (TASK-600) */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json: T = await res.json();
        if (!cancelled) {
          setState({ forUrl: url, data: json });
          setFailedFor((f) => (f === url ? null : f));
        }
      } catch {
        if (!cancelled) setFailedFor(url);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [url, nonce]);
  return {
    data: state?.forUrl === url ? state.data : null,
    failed: failedFor === url,
    loaded: state?.forUrl === url,
    retry: () => {
      setFailedFor(null);
      setNonce((n) => n + 1);
    },
  };
}

function QuoteHeader({ symbol, resolved }: { symbol: string; resolved: WatchlistEntry }) {
  const url = `/api/analysis?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(resolved.exchange)}&range=1y&interval=1d`;
  const { data, failed, loaded, retry } = useJson<{ quote: Quote }>(url);
  const q = loaded ? (data?.quote ?? null) : null;
  /* TASK-80 star: store-backed so the icon tracks remote/local mirrors */
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot,
  );
  const starred = watchlist.some(
    (x) => x.symbol === resolved.symbol && x.exchange === resolved.exchange,
  );
  const toggleStar = () => {
    if (starred || isInWatchlist(resolved)) {
      removeFromWatchlist(resolved.symbol, resolved.exchange);
      return;
    }
    addToWatchlist({
      ...resolved,
      name: q?.name ?? resolved.name,
    });
  };
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-paper sm:text-2xl">
            {q?.name ?? resolved.name}
          </h1>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-muted">
            {symbol}
            {q?.exchange ? ` · ${q.exchange}` : ` · ${resolved.exchange}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-xl font-medium tabular-nums text-paper sm:text-2xl">
              {failed || !loaded ? "—" : q?.price != null ? inr(q.price) : "—"}
            </p>
            {failed ? (
              <RetryChip onRetry={retry} />
            ) : (
              loaded &&
              q?.changePct != null && (
                <p
                  className={`font-mono text-sm font-medium tabular-nums ${
                    q.changePct >= 0 ? "text-up" : "text-down"
                  }`}
                >
                  {q.changePct >= 0 ? "+" : ""}
                  {q.changePct.toFixed(2)}%
                </p>
              )
            )}
          </div>
          {/* TASK-80 cross-nav: chart deep-link + watchlist star */}
          <Link
            href={`/?s=${encodeURIComponent(resolved.symbol)}&e=${encodeURIComponent(resolved.exchange)}&r=1y`}
            className="rounded-full bg-paper px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent"
          >
            Open chart →
          </Link>
          <StarToggle inList={starred} onToggle={toggleStar} />
        </div>
      </div>
    </div>
  );
}

interface StrategyMeta {
  id: string;
  name: string;
}

function Memberships({ symbol }: { symbol: string }) {
  const [state, setState] = useState<{ for: string; hits: StrategyMeta[] } | null>(null);
  /* keyed failure + user-triggered retry, matching useJson (TASK-600) */
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      /* signal_snapshots keys symbols bare (RELIANCE), URLs carry exchange
       * suffix (RELIANCE.NS) — compare on the base symbol */
      const base = symbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
      let metas: StrategyMeta[] = [];
      try {
        const res = await fetch("/api/strategies", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json: { strategies?: StrategyMeta[] } = await res.json();
        metas = json.strategies ?? [];
      } catch {
        if (!cancelled) setFailedFor(symbol);
        return;
      }
      const results = await Promise.allSettled(
        metas.map(async (s) => {
          const res = await fetch(
            `/api/signals?strategy=${encodeURIComponent(s.id)}&limit=200&sort=symbol`,
            { cache: "no-store" }
          );
          if (!res.ok) throw new Error(String(res.status));
          const json: { items?: { symbol: string }[] } = await res.json();
          return (json.items ?? []).some((i) => i.symbol.toUpperCase() === base) ? s : null;
        })
      );
      if (cancelled) return;
      if (results.some((r) => r.status === "rejected")) {
        setFailedFor(symbol);
        return;
      }
      const found = results.flatMap((r) => (r.status === "fulfilled" ? r.value ?? [] : []));
      setState({ for: symbol, hits: found });
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [symbol, nonce]);

  const failed = failedFor === symbol;
  const retry = () => {
    setFailedFor(null);
    setNonce((n) => n + 1);
  };

  if (state?.for !== symbol && !failed) {
    return (
      <div className="flex flex-wrap gap-2 px-1" aria-hidden>
        {[64, 88, 72].map((w, i) => (
          <span key={i} className="h-8 animate-pulse rounded-full bg-panel-2" style={{ width: w }} />
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <Empty
        text="Strategy signals unavailable right now."
        action={<RetryChip onRetry={retry} />}
      />
    );
  }
  const hits = state?.for === symbol ? state.hits : [];
  if (hits.length === 0) {
    return <Empty text="No current strategy signals include this symbol." />;
  }
  return (
    <div className="flex flex-wrap gap-2 px-1">
      {hits.map((s) => (
        <Link
          key={s.id}
          href={`/screener?strategy=${encodeURIComponent(s.id)}`}
          className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-muted shadow-sm transition-colors hover:border-line-strong hover:text-paper"
        >
          {s.name}
        </Link>
      ))}
    </div>
  );
}

const actionDate = (ts: number) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(ts * 1000));

function actionValue(a: CorpAction): string {
  if (a.subject) return a.subject;
  if (a.ratio == null) return "";
  if (a.type === "dividend") return `₹${a.ratio.toFixed(2)} per share`;
  if (a.type === "split") return `${a.ratio.toFixed(2)}×`;
  return `${a.ratio.toFixed(2)}×`;
}

function CorporateActions({ symbol }: { symbol: string }) {
  const url = `/api/corporate-actions?symbol=${encodeURIComponent(symbol)}`;
  const { data, failed, loaded, retry } = useJson<{ items: CorpAction[] }>(url);

  if (failed)
    return (
      <Empty
        text="Corporate actions unavailable right now."
        action={<RetryChip onRetry={retry} />}
      />
    );
  if (!loaded) {
    return (
      <div className="space-y-2 px-1" aria-hidden>
        {[80, 120].map((w, i) => (
          <span key={i} className="block h-5 animate-pulse rounded bg-panel-2" style={{ width: w }} />
        ))}
      </div>
    );
  }
  const items = data?.items ?? [];
  if (items.length === 0) return <Empty text="No corporate actions on file for this symbol." />;

  return (
    <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      {items.map((a, i) => (
        <li
          key={`${a.ts}-${a.type}`}
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm ${
            i > 0 ? "border-t border-line" : ""
          }`}
        >
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-faint">
            {actionDate(a.ts)}
          </span>
          <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-xs capitalize text-muted">
            {a.type}
          </span>
          <span className="min-w-0 flex-1 text-muted">{actionValue(a)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CompanyProfile({ symbol, resolved }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader
        subtitle={symbol}
        subtitleClassName="ml-1 hidden text-xs font-normal text-muted sm:inline"
        alerts={{ symbol, exchange: resolved.exchange }}
      />
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 p-4 sm:p-6">
        <QuoteHeader symbol={symbol} resolved={resolved} />
        <FundamentalsPanel symbol={symbol} />
        <Section label="Strategy memberships">
          <Memberships symbol={symbol} />
        </Section>
        <Section label="Analyst coverage">
          {/* analyst ingest API pending (TASK-57) — swap this placeholder
              for the panel when /api endpoint lands */}
          <Empty text="No analyst data on file yet." />
        </Section>
        <Section label="Corporate actions">
          <CorporateActions symbol={symbol} />
        </Section>
        <p className="text-xs leading-relaxed text-faint">
          Data is indicative and may be delayed ·{" "}
          <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
            Not investment advice
          </Link>
        </p>
      </main>
    </div>
  );
}
