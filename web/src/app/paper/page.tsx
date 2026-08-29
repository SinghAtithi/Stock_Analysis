"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Skeleton from "@/components/Skeleton";
import { inrCompact } from "@/lib/format";
import type { NiftyCandle, PaperBook, Side } from "@/lib/paperBook";
import {
  INITIAL_CASH,
  PAPER_KEY,
  appendPoint,
  bookPnlPct,
  equityValue,
  fillOrder,
  loadBook,
  newBook,
  niftyPctNow,
  niftyStartFrom,
  positionUnrealized,
  resetBook,
  saveBook,
} from "@/lib/paperBook";
import BenchmarkChart from "./benchmark-chart";
import PositionsTable, { type Quote } from "./positions-table";
import TradeForm, { type TradePreset } from "./trade-form";
import TradeHistory from "./trade-history";

interface OrderDraft {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  side: Side;
  qty: number;
  note: string;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const fmtPct = (v: number): string => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

const pnlCls = (v: number): string =>
  v > 0.005 ? "text-up" : v < -0.005 ? "text-down" : "text-muted";

const shortDate = (t: number): string =>
  new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function PaperPage() {
  const [book, setBook] = useState<PaperBook>(() =>
    typeof window === "undefined" ? newBook() : loadBook(),
  );
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [niftyCandles, setNiftyCandles] = useState<NiftyCandle[]>([]);
  const [niftyLoading, setNiftyLoading] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [preset, setPreset] = useState<TradePreset | null>(null);
  const [presetSeq, setPresetSeq] = useState(0);
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    saveBook(book);
  }, [book]);

  const symbolsKey = useMemo(
    () =>
      book.positions
        .map((p) => p.symbol)
        .sort()
        .join(","),
    [book.positions],
  );

  useEffect(() => {
    if (symbolsKey === "") return;
    let cancelled = false;
    const tick = async (force = false) => {
      if (!force && document.hidden) return;
      setQuotesLoading(true);
      try {
        const res = await fetch(
          `/api/watchlist-quotes?symbols=${encodeURIComponent(symbolsKey)}`,
        );
        if (!res.ok) throw new Error("quotes_failed");
        const json = (await res.json()) as {
          quotes?: { symbol: string; price: number | null; changePct: number | null }[];
        };
        if (cancelled) return;
        const next = new Map<string, Quote>();
        for (const q of json.quotes ?? []) {
          next.set(q.symbol.toUpperCase(), {
            price: q.price,
            changePct: q.changePct,
          });
        }
        setQuotes(next);
        setRefreshError(false);
        setBook((prev) => {
          if (prev.firstTradeAt == null || prev.positions.length === 0) {
            return prev;
          }
          if (niftyCandles.length === 0) return prev;
          const start =
            prev.niftyStart ?? niftyStartFrom(niftyCandles, prev.firstTradeAt);
          if (start == null) return prev;
          const niftyNow = niftyPctNow(niftyCandles, start);
          if (niftyNow == null) return prev;
          let seeded = prev;
          if (prev.curve.length === 0) {
            seeded = appendPoint(
              prev,
              prev.firstTradeAt,
              bookPnlPct(equityValue(prev, new Map())),
              0,
            );
          }
          const eq = equityValue(prev, pricesOf(next));
          return appendPoint(seeded, Date.now(), bookPnlPct(eq), niftyNow);
        });
      } catch {
        if (!cancelled) setRefreshError(true);
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };
    void tick(true);
    const t = setInterval(() => void tick(false), 60_000);
    const reeval = () => {
      if (!document.hidden) void tick(true);
    };
    document.addEventListener("visibilitychange", reeval);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", reeval);
    };
  }, [symbolsKey, refreshKey, niftyCandles]);

  useEffect(() => {
    if (book.firstTradeAt == null) return;
    let cancelled = false;
    const load = async () => {
      setNiftyLoading(true);
      try {
        const res = await fetch(
          "/api/chart?symbol=%5ENSEI&exchange=NSE&type=index&range=1y&interval=1d",
        );
        if (!res.ok) throw new Error("nifty_failed");
        const json = (await res.json()) as {
          candles?: { time: number; close: number }[];
        };
        const candles = (json.candles ?? []).filter(
          (c) =>
            Number.isFinite(c.time) &&
            Number.isFinite(c.close) &&
            c.close > 0,
        );
        if (!cancelled && candles.length > 0) setNiftyCandles(candles);
      } catch {
        /* benchmark degrades to "fetching" state — chart stays live */
      } finally {
        if (!cancelled) setNiftyLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [book.firstTradeAt, refreshKey]);

  const niftyStart = useMemo(() => {
    if (book.firstTradeAt == null) return null;
    if (niftyCandles.length > 0) {
      return niftyStartFrom(niftyCandles, book.firstTradeAt);
    }
    return book.niftyStart;
  }, [book.firstTradeAt, book.niftyStart, niftyCandles]);

  const prices = useMemo(() => pricesOf(quotes), [quotes]);
  const equity = useMemo(() => equityValue(book, prices), [book, prices]);
  const bookPct = bookPnlPct(equity);
  const invested = useMemo(
    () => book.positions.reduce((a, p) => a + p.qty * p.avgCost, 0),
    [book.positions],
  );
  const unrealized = useMemo(
    () =>
      book.positions.reduce((a, p) => {
        const px = prices.get(p.symbol) ?? p.avgCost;
        return a + positionUnrealized(p, px);
      }, 0),
    [book.positions, prices],
  );
  const realized = useMemo(
    () => book.positions.reduce((a, p) => a + p.realizedPnl, 0),
    [book.positions],
  );
  const niftyNow = niftyStart != null ? niftyPctNow(niftyCandles, niftyStart) : null;

  const handleSubmit = async (draft: OrderDraft) => {
    if (draft.type === "Index") {
      return { ok: false, error: "index_not_tradable" };
    }
    const key = draft.symbol.trim().toUpperCase();
    let q = quotes.get(key);
    if (!q || q.price == null || q.price <= 0) {
      try {
        const res = await fetch(
          `/api/watchlist-quotes?symbols=${encodeURIComponent(draft.symbol)}`,
        );
        if (res.ok) {
          const json = (await res.json()) as {
            quotes?: { symbol: string; price: number | null; changePct: number | null }[];
          };
          const hit = (json.quotes ?? []).find(
            (x) => x.symbol.toUpperCase() === key,
          );
          if (hit && hit.price != null && hit.price > 0) {
            const quote: Quote = { price: hit.price, changePct: hit.changePct };
            q = quote;
            setQuotes((prev) => new Map(prev).set(key, quote));
          }
        }
      } catch {
        /* fall through to price_unavailable */
      }
    }
    if (!q || q.price == null || q.price <= 0) {
      return { ok: false, error: "price_unavailable" };
    }
    const res = fillOrder(book, {
      ...draft,
      symbol: key,
      refPrice: q.price,
      slippagePct: book.slippagePct,
      time: Date.now(),
    });
    if (res.error) return { ok: false, error: res.error };
    setBook(res.book);
    return { ok: true };
  };

  const sellQuick = (symbol: string) => {
    const p = book.positions.find((x) => x.symbol === symbol);
    if (!p) return;
    setPreset({
      symbol: p.symbol,
      name: p.name,
      exchange: p.exchange,
      type: p.type,
      side: "sell",
    });
    setPresetSeq((s) => s + 1);
    document.getElementById("trade-form")?.scrollIntoView({ block: "start" });
  };

  const saveNote = (id: string, note: string) => {
    setBook((prev) => ({
      ...prev,
      trades: prev.trades.map((t) => (t.id === id ? { ...t, note } : t)),
    }));
  };

  const onSlippage = (raw: string) => {
    const n = Number(raw);
    const pct = Number.isFinite(n)
      ? Math.min(Math.max(n, 0), 1) / 100
      : book.slippagePct;
    setBook((prev) => ({ ...prev, slippagePct: pct }));
  };

  const armReset = () => {
    setResetArmed(true);
    window.setTimeout(() => setResetArmed(false), 4000);
  };

  const doReset = () => {
    resetBook();
    setBook(newBook());
    setQuotes(new Map());
    setNiftyCandles([]);
    setPreset(null);
    setRefreshError(false);
    setResetArmed(false);
  };

  const fresh = book.trades.length === 0 && book.positions.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Paper trading" subtitleClassName="font-normal text-muted" />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">
                Paper trading
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                A virtual ₹10L book that fills at the last delayed price with
                configurable slippage, tracks unrealized and realized P&L, and
                benchmarks your decisions against Nifty 50 from your first
                trade.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">
              Paper trading — virtual money, no real trades
            </span>
          </div>
        </div>

        <section
          aria-label="Book summary"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-sm lg:grid-cols-6"
        >
          {[
            { label: "Cash available", value: inrCompact(book.cash), cls: "text-paper" },
            { label: "Invested", value: inrCompact(invested), cls: "text-paper" },
            { label: "Equity value", value: inrCompact(equity), cls: "text-paper" },
            { label: "Unrealized P&L", value: inrCompact(unrealized), cls: pnlCls(unrealized) },
            { label: "Realized P&L", value: inrCompact(realized), cls: pnlCls(realized) },
            { label: "Book P&L", value: fmtPct(bookPct), cls: pnlCls(bookPct) },
          ].map((s) => (
            <div key={s.label} className="bg-surface px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-faint uppercase">
                {s.label}
              </p>
              <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${s.cls}`}>
                {s.value}
              </p>
            </div>
          ))}
        </section>

        {refreshError && (
          <p
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down"
          >
            <span className="flex-1">
              Quotes feed unreachable — showing last known prices.
            </span>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-panel-2"
            >
              Retry
            </button>
          </p>
        )}

        {fresh && (
          <section
            aria-label="Getting started"
            className="rounded-2xl border border-dashed border-line bg-surface px-5 py-6 text-sm leading-relaxed text-muted"
          >
            <p className="font-medium text-paper">
              Start your virtual book with ₹10,00,000
            </p>
            <ul className="mt-2 max-w-3xl list-disc space-y-1 pl-5">
              <li>Pick a symbol with the search box below and place a buy.</li>
              <li>
                Fills use the last delayed price, plus or minus your slippage
                setting.
              </li>
              <li>
                Unrealized P&L updates on each price refresh; a benchmark curve
                vs Nifty 50 begins at your first trade.
              </li>
              <li>
                Attach a decision journal note to every trade — it stays with
                the trade in this browser only.
              </li>
            </ul>
          </section>
        )}

        <TradeForm
          key={presetSeq}
          slippagePct={book.slippagePct}
          preset={preset}
          onSubmit={handleSubmit}
        />

        <PositionsTable
          positions={book.positions}
          quotes={quotes}
          loading={quotesLoading}
          onSellQuick={sellQuick}
        />

        <section
          aria-labelledby="benchmark-heading"
          className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="benchmark-heading"
              className="text-sm font-semibold text-paper"
            >
              Book vs Nifty 50
            </h2>
            <p className="text-xs text-faint">
              {book.firstTradeAt != null
                ? `Since ${shortDate(book.firstTradeAt)} · baseline ${book.niftyStart != null ? inr.format(book.niftyStart) : "pending"}`
                : "Starts at your first trade"}
            </p>
          </div>
          <div className="mt-4">
            {niftyLoading && niftyCandles.length === 0 ? (
              <Skeleton className="h-44 w-full rounded-lg" />
            ) : (
              <BenchmarkChart
                curve={book.curve}
                bookPct={bookPct}
                niftyPct={niftyNow}
                firstTradeAt={book.firstTradeAt}
              />
            )}
          </div>
        </section>

        <TradeHistory trades={book.trades} onSaveNote={saveNote} />

        <section
          aria-labelledby="settings-heading"
          className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
        >
          <h2 id="settings-heading" className="text-sm font-semibold text-paper">
            Slippage &amp; book
          </h2>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="paper-slippage"
                className="block text-xs font-medium text-muted"
              >
                Slippage per fill (%)
              </label>
              <input
                id="paper-slippage"
                type="number"
                min="0"
                max="1"
                step="0.05"
                inputMode="decimal"
                value={(book.slippagePct * 100).toFixed(2)}
                onChange={(e) => onSlippage(e.target.value)}
                className="w-28 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm tabular-nums text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
              <p className="max-w-md text-xs leading-relaxed text-faint">
                Applied to the last delayed price at fill time — buys pay{" "}
                {(book.slippagePct * 100).toFixed(2)}% above, sells receive{" "}
                {(book.slippagePct * 100).toFixed(2)}% below. Prices are
                delayed, not real-time.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="block text-xs font-medium text-muted">
                Reset
              </span>
              <button
                type="button"
                onClick={resetArmed ? doReset : armReset}
                className={
                  resetArmed
                    ? "rounded-full bg-down px-4 py-2 text-sm font-medium text-canvas transition-colors hover:opacity-90"
                    : "rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted transition-colors hover:border-down/40 hover:text-down"
                }
              >
                {resetArmed ? "Confirm reset" : "Reset book"}
              </button>
              <p className="max-w-md text-xs leading-relaxed text-faint">
                Wipes cash, positions, trades, journal and benchmark curve back
                to a fresh ₹10L.
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-faint">
          <span>
            All state lives in <span className="font-mono">{PAPER_KEY}</span> in
            this browser only — nothing is uploaded, no real orders are placed.{" "}
            {INITIAL_CASH.toLocaleString("en-IN")} virtual rupees, slippage{" "}
            {(book.slippagePct * 100).toFixed(2)}%.
          </span>
          <Link
            href="/disclaimer"
            className="underline decoration-line underline-offset-2 hover:text-muted"
          >
            Not investment advice
          </Link>
        </footer>
      </main>
    </div>
  );
}

function pricesOf(
  quotes: Map<string, Quote>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, q] of quotes) {
    if (q.price != null && q.price > 0) out.set(k, q.price);
  }
  return out;
}