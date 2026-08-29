"use client";

import { useState, type FormEvent } from "react";
import Search from "@/components/Search";
import type { SearchResult } from "@/lib/types";
import type { Side } from "@/lib/paperBook";
import { NOTE_MAX } from "@/lib/paperBook";

export interface TradePreset {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  side: Side;
}

interface OrderDraft {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  side: Side;
  qty: number;
  note: string;
}

interface Props {
  slippagePct: number;
  preset: TradePreset | null;
  onSubmit: (draft: OrderDraft) => Promise<{ ok: boolean; error?: string }>;
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-paper placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const labelCls = "block text-xs font-medium text-muted";

export default function TradeForm({ slippagePct, preset, onSubmit }: Props) {
  const [symbol, setSymbol] = useState<string>(preset?.symbol ?? "");
  const [name, setName] = useState<string>(preset?.name ?? "");
  const [exchange, setExchange] = useState<string>(preset?.exchange ?? "NSE");
  const [type, setType] = useState<string>(preset?.type ?? "Equity");
  const [side, setSide] = useState<Side>(preset?.side ?? "buy");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (r: SearchResult) => {
    setSymbol(r.symbol);
    setName(r.name || r.shortName);
    setExchange(r.exchange);
    setType(r.type);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!symbol) {
      setError("Pick a symbol from the search box first.");
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }
    if (!Number.isInteger(q)) {
      setError("Quantity must be a whole number of shares.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await onSubmit({
      symbol,
      name,
      exchange,
      type,
      side,
      qty: q,
      note,
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === "index_not_tradable"
          ? "Indices can't be traded in the paper book — they're the benchmark only."
          : res.error === "not_enough_cash"
            ? "Not enough virtual cash for this fill."
            : res.error === "no_position"
              ? `No open position in ${symbol} to sell.`
              : res.error === "qty_exceeds_position"
                ? `You only hold a smaller quantity of ${symbol}.`
                : res.error === "price_unavailable"
                  ? "No recent price known for this symbol — try again in a few minutes."
                  : res.error ?? "Could not place the paper trade."
      );
      return;
    }
    setQty("");
    setNote("");
  };

  return (
    <section
      id="trade-form"
      aria-labelledby="trade-form-heading"
      className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="trade-form-heading" className="text-sm font-semibold text-paper">
          Place a paper trade
        </h2>
        <p className="text-xs text-faint">
          Fills at the last delayed price {side === "buy" ? "plus" : "minus"}{" "}
          {(slippagePct * 100).toFixed(2)}% slippage
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
          <div className="flex flex-col gap-1">
            <label htmlFor="paper-search" className={labelCls}>
              Symbol
            </label>
            <div id="paper-search">
              <Search onSelect={pick} />
            </div>
            {symbol && (
              <p className="mt-1 text-xs text-faint">
                {type === "Index"
                  ? `${symbol} is an index — benchmark only, not tradable.`
                  : `Trading ${symbol} · ${name}`}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="paper-qty" className={labelCls}>
              Quantity
            </label>
            <input
              id="paper-qty"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              className={`${inputCls} font-mono tabular-nums`}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelCls}>Side</span>
            <div
              role="group"
              aria-label="Side"
              className="flex overflow-hidden rounded-lg border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => setSide("buy")}
                aria-pressed={side === "buy"}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  side === "buy"
                    ? "bg-up-soft text-up"
                    : "text-muted hover:text-paper"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setSide("sell")}
                aria-pressed={side === "sell"}
                className={`flex-1 border-l border-line px-4 py-2 text-sm font-medium transition-colors ${
                  side === "sell"
                    ? "bg-down-soft text-down"
                    : "text-muted hover:text-paper"
                }`}
              >
                Sell
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="paper-note" className={labelCls}>
            Decision journal note (optional)
          </label>
          <textarea
            id="paper-note"
            rows={2}
            maxLength={NOTE_MAX}
            className={`${inputCls} resize-y leading-relaxed`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this trade? Thesis, level, stop, conviction…"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-faint">
            Virtual ₹10L book — fills do not touch real money.
          </p>
          <button
            type="submit"
            disabled={busy || !symbol}
            className="rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Placing…" : side === "buy" ? "Buy" : "Sell"}
          </button>
        </div>
      </form>
    </section>
  );
}