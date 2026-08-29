"use client";

import { useState, type FormEvent } from "react";
import type { TaxLot } from "@/lib/taxLots";
import { toISODate } from "@/lib/taxLots";

const today = toISODate(new Date());

interface Props {
  onAdd: (lot: Omit<TaxLot, "id">) => void;
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-paper placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const labelCls = "block text-xs font-medium text-muted";

export default function AddLotForm({ onAdd }: Props) {
  const [symbol, setSymbol] = useState("");
  const [buyDate, setBuyDate] = useState(today);
  const [qty, setQty] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(qty);
    const avg = Number(avgPrice);
    const cur = Number(currentPrice);
    if (!buyDate) return setError("Buy date is required.");
    if (!Number.isFinite(q) || q <= 0) return setError("Quantity must be a positive number.");
    if (!Number.isFinite(avg) || avg < 0) return setError("Average price must be 0 or more.");
    if (!Number.isFinite(cur) || cur < 0) return setError("Current price must be 0 or more.");
    setError(null);
    onAdd({
      symbol: symbol.trim().toUpperCase(),
      buyDate,
      qty: q,
      avgPrice: avg,
      currentPrice: cur,
    });
    setSymbol("");
    setQty("");
    setAvgPrice("");
    setCurrentPrice("");
  };

  return (
    <section aria-labelledby="add-lot-heading" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 id="add-lot-heading" className="text-sm font-semibold text-paper">
        Add a lot
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        One buy transaction per lot. Symbol is optional — sell price is taken from the current
        price field, no live quotes needed.
      </p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-symbol" className={labelCls}>
            Symbol (optional)
          </label>
          <input
            id="lot-symbol"
            className={inputCls}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="RELIANCE"
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-buy-date" className={labelCls}>
            Buy date
          </label>
          <input
            id="lot-buy-date"
            type="date"
            className={`${inputCls} font-mono tabular-nums`}
            value={buyDate}
            max={today}
            onChange={(e) => setBuyDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-qty" className={labelCls}>
            Quantity
          </label>
          <input
            id="lot-qty"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={`${inputCls} font-mono tabular-nums`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="100"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-avg-price" className={labelCls}>
            Avg price (₹)
          </label>
          <input
            id="lot-avg-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={`${inputCls} font-mono tabular-nums`}
            value={avgPrice}
            onChange={(e) => setAvgPrice(e.target.value)}
            placeholder="2500.00"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="lot-current-price" className={labelCls}>
            Current price (₹)
          </label>
          <input
            id="lot-current-price"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={`${inputCls} font-mono tabular-nums`}
            value={currentPrice}
            onChange={(e) => setCurrentPrice(e.target.value)}
            placeholder="2650.00"
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-down sm:col-span-4">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 sm:col-span-5 lg:col-span-1 lg:justify-self-end"
        >
          Add lot
        </button>
      </form>
    </section>
  );
}