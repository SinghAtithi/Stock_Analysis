"use client";

import { useEffect, useState } from "react";

/* FundamentalsPanel — T49. PE / PB / ROE / D:E / margins from
 * /api/fundamentals?symbol=, with as-of stamp + source tag and an empty
 * state when the ingest table has no row for the symbol yet.
 */

interface Metrics {
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  dividendYield: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  sector: string | null;
  industry: string | null;
}

interface Payload {
  metrics: Metrics | null;
  meta: { as_of: string | null; source: string | null };
}

const fmt = (v: number | null, digits = 2): string =>
  v === null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

const pct = (v: number | null): string =>
  v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;

export default function FundamentalsPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      setFailed(false);
      try {
        const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json: Payload = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const m = data?.metrics ?? null;

  if (!m) {
    if (failed) {
      return (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-sm text-muted">Fundamentals unavailable right now.</p>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed border-line bg-canvas px-4 py-6 text-center">
        <p className="text-sm font-medium text-paper">No fundamentals yet</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          The nightly fundamentals ingest has not covered {symbol} so far — ratios appear after its first run.
        </p>
      </div>
    );
  }

  const cells: { label: string; value: string }[] = [
    { label: "P/E", value: fmt(m.trailingPe) },
    { label: "Fwd P/E", value: fmt(m.forwardPe) },
    { label: "P/B", value: fmt(m.priceToBook) },
    { label: "D/E", value: fmt(m.debtToEquity) },
    { label: "ROE", value: pct(m.returnOnEquity) },
    { label: "ROA", value: pct(m.returnOnAssets) },
    { label: "Gross margin", value: pct(m.grossMargin) },
    { label: "Op margin", value: pct(m.operatingMargin) },
    { label: "Net margin", value: pct(m.netMargin) },
    { label: "Div yield", value: m.dividendYield === null ? "—" : `${(m.dividendYield * 100).toFixed(2)}%` },
    { label: "Current ratio", value: fmt(m.currentRatio) },
    { label: "P/S", value: fmt(m.priceToSales) },
  ];

  const asOf = data?.meta.as_of ? new Date(data.meta.as_of) : null;
  const asOfLabel = asOf
    ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }).format(asOf)
    : null;

  return (
    <section aria-label="Fundamental ratios">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm"
          >
            <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{c.label}</p>
            <p className="mt-1 font-mono text-[15px] font-medium tabular-nums text-paper">{c.value}</p>
          </div>
        ))}
      </div>
      {(asOfLabel || m.sector) && (
        <p className="mt-2 px-1 text-[11px] text-faint">
          {m.sector ?? ""}
          {m.sector && m.industry ? " · " : ""}
          {m.industry ?? ""}
          {asOfLabel ? ` · as of ${asOfLabel} IST · ${data?.meta.source ?? "—"}` : ""}
        </p>
      )}
    </section>
  );
}
