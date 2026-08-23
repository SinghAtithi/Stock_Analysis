"use client";

import { useEffect, useState, type ReactNode } from "react";

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

function Shell({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Fundamentals" className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
      {children}
    </section>
  );
}

export default function FundamentalsPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /* keyed to the symbol that failed — one bad fetch must not poison other
     symbols (TASK-875); success below clears it so a later visit retries */
  const [failedFor, setFailedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json: Payload = await res.json();
        if (!cancelled) {
          setData(json);
          setLoadedFor(symbol);
          setFailedFor((f) => (f === symbol ? null : f));
        }
      } catch {
        if (!cancelled) setFailedFor(symbol);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const fresh = loadedFor === symbol;
  const m = fresh ? (data?.metrics ?? null) : null;

  if (!fresh && failedFor === symbol) {
    return (
      <Shell>
        <p className="text-sm text-muted">Fundamentals unavailable right now.</p>
      </Shell>
    );
  }

  if (!fresh) {
    return (
      <Shell>
        <span
          aria-hidden
          className="inline-block h-[0.9em] w-40 animate-pulse rounded bg-panel-2 align-baseline"
        />
      </Shell>
    );
  }

  if (!m) {
    return (
      <Shell>
        <p className="text-sm text-muted">No fundamentals on file for this symbol.</p>
      </Shell>
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
  ].filter((c) => c.value !== "—");

  if (cells.length === 0) {
    return (
      <Shell>
        <p className="text-sm text-muted">No fundamentals on file for this symbol.</p>
      </Shell>
    );
  }

  const asOf = data?.meta.as_of ? new Date(data.meta.as_of) : null;
  const asOfLabel = asOf
    ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }).format(asOf)
    : null;

  return (
    <section aria-label="Fundamentals">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 pb-2">
        <span className="text-xs font-medium tracking-wide text-muted">Fundamentals</span>
        {(asOfLabel || data?.meta.source) && (
          <span className="font-mono text-[11px] tabular-nums text-faint">
            {asOfLabel ? `as of ${asOfLabel} IST` : null}
            {asOfLabel && data?.meta.source ? " · " : ""}
            {data?.meta.source ?? ""}
          </span>
        )}
      </div>
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
      {(m.sector || m.industry) && (
        <p className="mt-2 px-1 text-[11px] text-faint">
          {[m.sector, m.industry].filter(Boolean).join(" · ")}
        </p>
      )}
    </section>
  );
}
