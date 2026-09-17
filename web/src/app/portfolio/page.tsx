"use client";

/* TASK-1378 — portfolio x-ray: paste a Zerodha/Groww holdings CSV, preview
   the tolerant parse, then read sector/cap concentration, Nifty-50 overlap
   and factor exposure. All processing is client-side; holdings persist in
   localStorage under PORTFOLIO_KEY and are never uploaded. */

import { useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "@/components/SiteHeader";
import DataTable from "@/components/DataTable";
import Skeleton from "@/components/Skeleton";
import { findInstrument, isIndexSymbol } from "@/lib/instruments";
import {
  CONCENTRATED_HHI,
  FACTOR_LABELS,
  FACTOR_STRATEGIES,
  PORTFOLIO_KEY,
  classifyCap,
  computeConcentration,
  computeFactorExposure,
  computeNiftyOverlap,
  parsePortfolioCsv,
  type FactorExposure,
  type FactorName,
  type FactorScores,
  type HoldingRow,
  type InstrumentMeta,
} from "@/lib/portfolio";
import Donut, { type DonutSlice } from "./donut";

const fmtInr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const fmtQty = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const fmtPrice = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtPct = (n: number, d = 0) => `${n.toFixed(d)}%`;
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

interface Resolved {
  symbol: string;
  name: string;
  sector: string | null;
  idx: string[] | undefined;
  cap: string;
  nifty50: boolean;
}

function resolveHolding(symbol: string): Resolved | null {
  const inst = findInstrument(symbol);
  if (!inst || isIndexSymbol(inst.s, inst.n)) return null;
  return {
    symbol: inst.s,
    name: inst.n,
    sector: inst.sec ?? null,
    idx: inst.idx,
    cap: classifyCap(inst.idx),
    nifty50: inst.idx?.includes("NIFTY 50") ?? false,
  };
}

function loadHoldings(): HoldingRow[] {
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (h): h is HoldingRow =>
        h &&
        typeof h.symbol === "string" &&
        typeof h.qty === "number" &&
        typeof h.avgPrice === "number" &&
        typeof h.value === "number",
    );
  } catch {
    return [];
  }
}

interface FactorResult {
  key: string;
  exposures: FactorExposure[] | null;
  error: boolean;
}

const FACTOR_ENTRIES = Object.entries(FACTOR_STRATEGIES) as [
  FactorName,
  string[],
][];

export default function PortfolioPage() {
  const [csvText, setCsvText] = useState("");
  const [imported, setImported] = useState<HoldingRow[]>([]);
  const [factorResult, setFactorResult] = useState<FactorResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const hydrated = useRef(false);

  /* Load persisted holdings after mount — reading localStorage during first
     render would mismatch the SSR'd empty tree (TASK-1378: reload-with-data
     is the normal flow, so hydration must stay clean). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      hydrated.current = true;
      setImported(loadHoldings());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const preview = useMemo(() => parsePortfolioCsv(csvText), [csvText]);
  const holdingsKey = JSON.stringify(imported);

  const resolved = useMemo(() => {
    const map = new Map<string, Resolved>();
    for (const h of imported) {
      const r = resolveHolding(h.symbol);
      if (r) map.set(h.symbol, r);
    }
    return map;
  }, [imported]);

  const resolveMeta = (symbol: string): InstrumentMeta | null => {
    const r = resolved.get(symbol);
    return r ? { sector: r.sector ?? undefined, idx: r.idx } : null;
  };

  const concentration = computeConcentration(imported, resolveMeta);
  const overlap = computeNiftyOverlap(imported, resolveMeta);

  const totalValue = imported.reduce((a, h) => a + h.value, 0);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(imported));
    } catch {}
  }, [imported]);

  /* Factor exposure — read the latest signal_snapshots via /api/signals
     (public read; holdings never leave the browser). */
  useEffect(() => {
    if (imported.length === 0) return;
    let cancelled = false;
    const key = holdingsKey;
    (async () => {
      const perFactor = await Promise.all(
        FACTOR_ENTRIES.map(async ([factor, strategyIds]) => {
          const perStrategy = await Promise.all(
            strategyIds.map(async (sid) => {
              try {
                const res = await fetch(
                  `/api/signals?strategy=${encodeURIComponent(sid)}&limit=200`,
                );
                if (!res.ok) return null;
                const json = (await res.json()) as {
                  items?: { symbol: string; score: number | null }[];
                  strategy?: { asOf?: number | null };
                };
                const items = json.items ?? [];
                const map = new Map<string, number>();
                for (const it of items) {
                  if (typeof it.score === "number" && Number.isFinite(it.score)) {
                    map.set(it.symbol, it.score);
                  }
                }
                const asOf = json.strategy?.asOf ?? null;
                return map.size > 0 ? { map, asOf } : null;
              } catch {
                return null;
              }
            }),
          );
          let asOf: number | null = null;
          const maps: Map<string, number>[] = [];
          for (const p of perStrategy) {
            if (!p) continue;
            maps.push(p.map);
            if (p.asOf !== null && (asOf === null || p.asOf > asOf)) asOf = p.asOf;
          }
          return { factor, maps, asOf };
        }),
      );
      if (cancelled) return;
      const scores: FactorScores = {};
      const asOfByFactor: Partial<Record<FactorName, number | null>> = {};
      for (const p of perFactor) {
        scores[p.factor] = p.maps;
        asOfByFactor[p.factor] = p.asOf;
      }
      setFactorResult({
        key,
        exposures: computeFactorExposure(imported, scores, asOfByFactor),
        error: false,
      });
    })().catch(() => {
      if (!cancelled) setFactorResult({ key, exposures: null, error: true });
    });
    return () => {
      cancelled = true;
    };
  }, [imported, holdingsKey, reloadKey]);

  const factorsLoading =
    imported.length > 0 &&
    (factorResult === null || factorResult.key !== holdingsKey);

  const doImport = () => {
    if (preview.holdings.length === 0) return;
    setImported(preview.holdings);
  };

  const doClear = () => {
    setImported([]);
    setCsvText("");
  };

  const onFile = (file: File | null | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setCsvText(reader.result);
    };
    reader.readAsText(file);
  };

  const canImport = preview.holdings.length > 0;

  const sectorSlices: DonutSlice[] = concentration.sectors.map((s) => ({
    label: s.label,
    pct: s.pct,
    value: s.value,
  }));
  const capSlices: DonutSlice[] = concentration.caps.map((s) => ({
    label: s.label,
    pct: s.pct,
    value: s.value,
  }));
  const topCap = concentration.caps[0];

  const holdingsRows = imported.map((h) => {
    const r = resolved.get(h.symbol);
    return { ...h, resolved: r ?? null };
  });

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Portfolio x-ray" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6"
      >
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">
            Portfolio x-ray
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Paste your Zerodha or Groww holdings CSV and read the concentration,
            Nifty-50 overlap and factor tilt of your book. All processing happens in
            this browser — nothing is uploaded.
          </p>
        </header>

        <section
          className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
          aria-label="Import holdings"
        >
          <h2 className="text-base font-semibold tracking-tight text-paper">
            Import holdings
          </h2>
          <p className="mt-1 text-sm text-muted">
            Accepted columns: <span className="font-mono">Symbol</span>,{" "}
            <span className="font-mono">Quantity/Qty</span>,{" "}
            <span className="font-mono">Avg price/Avg. cost/Net avg</span> — headers
            are matched case-insensitively and ₹/commas/NSE-BSE suffixes are
            tolerated.
          </p>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={
              "Symbol,Qty,Avg price\nRELIANCE,10,2450.50\nTCS,5,3890.00"
            }
            aria-label="Paste holdings CSV"
            spellCheck={false}
            className="mt-3 min-h-32 w-full resize-y rounded-xl border border-line bg-panel-2 p-3 font-mono text-sm text-paper placeholder:text-faint focus:border-line-strong focus:outline-none"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]);
            }}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-full border border-line bg-panel-2 px-4 py-1.5 text-sm text-paper transition-colors duration-200 hover:border-line-strong focus-within:outline-2 focus-within:outline-paper">
              Choose CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              onClick={doImport}
              disabled={!canImport}
              className="rounded-full bg-paper px-4 py-1.5 text-sm font-medium text-ink transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Import {preview.holdings.length > 0 ? `${preview.holdings.length} holdings` : "holdings"}
            </button>
            {imported.length > 0 && (
              <button
                type="button"
                onClick={doClear}
                className="rounded-full border border-line px-4 py-1.5 text-sm text-muted transition-colors duration-200 hover:border-line-strong hover:text-paper"
              >
                Clear saved portfolio
              </button>
            )}
          </div>

          {csvText !== "" && (
            <div className="mt-4 border-t border-line pt-4">
              {preview.headerless && (
                <p className="rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                  No known header row detected — treated the first line as data and
                  assumed Symbol, Quantity, Average price columns. Check the preview
                  before importing.
                </p>
              )}
              {preview.missing.length > 0 && (
                <p className="mt-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                  Couldn&apos;t find column{preview.missing.length > 1 ? "s" : ""}:{" "}
                  {preview.missing.join(", ")} — affected rows are skipped below.
                </p>
              )}
              <p className="mt-3 text-sm text-paper">
                {preview.holdings.length === 0
                  ? "Nothing parseable yet."
                  : `${preview.holdings.length} holding${preview.holdings.length === 1 ? "" : "s"} parsed`}
                {preview.skipped.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    · {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"} skipped
                  </span>
                )}
              </p>
              {preview.holdings.length > 0 && (
                <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-line">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                        <th scope="col" className="px-3 py-2 font-medium">Symbol</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Avg price</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Invested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.holdings.slice(0, 50).map((h) => (
                        <tr key={h.symbol} className="border-b border-line/60 last:border-b-0">
                          <td className="px-3 py-2 font-mono text-paper">{h.symbol}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted">{fmtQty.format(h.qty)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted">{fmtPrice.format(h.avgPrice)}</td>
                          <td className="px-3 py-2 text-right font-mono text-paper">{fmtInr.format(h.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview.skipped.length > 0 && (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer select-none py-1 hover:text-paper">
                    {preview.skipped.length} skipped row{preview.skipped.length === 1 ? "" : "s"} — show
                  </summary>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
                    {preview.skipped.slice(0, 100).map((s) => (
                      <li key={s.line} className="font-mono">
                        Line {s.line}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>

        {imported.length > 0 && (
          <>
            <section
              className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
              aria-label="Allocation verdict"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
                    concentration.verdict === "Concentrated"
                      ? "bg-warn-soft text-warn"
                      : "bg-accent-soft text-paper"
                  }`}
                >
                  {concentration.verdict}
                </span>
                <p className="text-sm leading-relaxed text-muted">
                  {concentration.verdict === "Concentrated" ? (
                    <>
                      Top sector {concentration.topSector?.label ?? "—"} carries{" "}
                      <span className="font-mono text-paper">
                        {fmtPct((concentration.topSector?.pct ?? 0) * 100)}
                      </span>{" "}
                      of invested value — sector Herfindahl{" "}
                      <span className="font-mono text-paper">
                        {concentration.hhi.toFixed(2)}
                      </span>{" "}
                      at or above the {CONCENTRATED_HHI} threshold.
                    </>
                  ) : (
                    <>
                      No single sector dominates — sector Herfindahl{" "}
                      <span className="font-mono text-paper">
                        {concentration.hhi.toFixed(2)}
                      </span>{" "}
                      is below the {CONCENTRATED_HHI} threshold.
                    </>
                  )}
                </p>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section
                className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
                aria-label="Sector concentration"
              >
                <h2 className="text-base font-semibold tracking-tight text-paper">
                  Sector concentration
                </h2>
                <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <Donut
                    slices={sectorSlices}
                    label="Sector allocation"
                    centerTop={
                      concentration.topSector
                        ? fmtPct(concentration.topSector.pct * 100)
                        : undefined
                    }
                    centerSub={concentration.topSector ? "top sector" : undefined}
                  />
                  <ul className="w-full space-y-1.5 text-sm">
                    {concentration.sectors.map((s, i) => (
                      <li key={s.label} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: "var(--color-accent)",
                            opacity: 1 - Math.min(i * 0.18, 0.8),
                          }}
                        />
                        <span className="flex-1 truncate text-muted">{s.label}</span>
                        <span className="font-mono text-paper">{fmtPct(s.pct * 100)}</span>
                        <span className="w-20 text-right font-mono text-faint">
                          {fmtInr.format(s.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-faint">
                  Sectors from the local instrument index. Verdict: sector Herfindahl
                  index ≥ {CONCENTRATED_HHI} → &ldquo;Concentrated&rdquo; (DOJ-style threshold).
                  {concentration.unmatched.length > 0 && (
                    <>
                      {" "}
                      {concentration.unmatched.length} holding
                      {concentration.unmatched.length === 1 ? "" : "s"} not in the
                      instrument index (or index/ETF listings) are excluded:{" "}
                      <span className="font-mono">{concentration.unmatched.join(", ")}</span>
                    </>
                  )}
                </p>
              </section>

              <section
                className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
                aria-label="Cap allocation"
              >
                <h2 className="text-base font-semibold tracking-tight text-paper">
                  Cap allocation
                </h2>
                <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <Donut
                    slices={capSlices}
                    label="Cap allocation"
                    centerTop={topCap ? fmtPct(topCap.pct * 100) : undefined}
                    centerSub={topCap ? "largest bucket" : undefined}
                  />
                  <ul className="w-full space-y-1.5 text-sm">
                    {concentration.caps.map((s, i) => (
                      <li key={s.label} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: "var(--color-accent)",
                            opacity: 1 - Math.min(i * 0.18, 0.8),
                          }}
                        />
                        <span className="flex-1 text-muted">{s.label}</span>
                        <span className="font-mono text-paper">{fmtPct(s.pct * 100)}</span>
                        <span className="w-20 text-right font-mono text-faint">
                          {fmtInr.format(s.value)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-faint">
                  Cap is approximated from Nifty index membership (NIFTY 50 / NEXT 50
                  → Large, MIDCAP 150 → Mid, SMALLCAP 250 → Small), not from a
                  market-cap figure.
                </p>
              </section>

              <section
                className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
                aria-label="Overlap with Nifty 50"
              >
                <h2 className="text-base font-semibold tracking-tight text-paper">
                  Overlap vs Nifty 50
                </h2>
                <p className="mt-3 text-4xl font-semibold tracking-tight text-paper">
                  <span className="font-mono">{fmtPct(overlap.pct)}</span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  of invested value sits in Nifty 50 names —{" "}
                  <span className="font-mono">
                    {overlap.nifty50Count} of {overlap.matchedCount}
                  </span>{" "}
                  resolved holdings.
                </p>
                <p className="mt-4 text-[11px] leading-relaxed text-faint">
                  Membership from the local instrument index. Holdings that resolve
                  to nothing (or index/ETF listings) are excluded from this share.
                </p>
              </section>

              <section
                className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
                aria-label="Factor exposure"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold tracking-tight text-paper">
                    Factor exposure
                  </h2>
                  {factorResult?.error && (
                    <button
                      type="button"
                      onClick={() => setReloadKey((k) => k + 1)}
                      className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors duration-200 hover:border-line-strong hover:text-paper"
                    >
                      Retry
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">
                  Value-weighted tilt of your book against each factor, from the
                  latest signal snapshots.
                </p>
                <div className="mt-4 space-y-3">
                  {factorsLoading && (
                    <div className="space-y-3" aria-hidden>
                      {FACTOR_ENTRIES.map(([factor]) => (
                        <Skeleton key={factor} className="block h-8 w-full" />
                      ))}
                    </div>
                  )}
                  {!factorsLoading && factorResult?.error && (
                    <p className="text-sm text-muted">
                      Factor data unavailable — the signals service didn&apos;t respond.
                    </p>
                  )}
                  {!factorsLoading && !factorResult?.error && factorResult?.exposures && (
                    <>
                      {factorResult.exposures.map((f) => (
                        <div key={f.factor}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm text-paper">{FACTOR_LABELS[f.factor]}</span>
                            <span className="text-right">
                              {f.pct === null ? (
                                <span className="text-xs text-faint">No data</span>
                              ) : (
                                <span className="font-mono text-sm text-paper">
                                  {fmtPct(f.pct)}
                                </span>
                              )}
                            </span>
                          </div>
                          <div
                            className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2"
                            role="img"
                            aria-label={
                              f.pct === null
                                ? `${FACTOR_LABELS[f.factor]} exposure: no signal data`
                                : `${FACTOR_LABELS[f.factor]} exposure ${Math.round(f.pct)} of 100, covering ${fmtPct(f.coverage * 100)} of invested value`
                            }
                          >
                            {f.pct !== null && (
                              <div
                                className="h-full rounded-full bg-accent transition-all duration-200 ease-out"
                                style={{ width: `${Math.min(Math.max(f.pct, 0), 100)}%` }}
                              />
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-faint">
                            {f.pct === null
                              ? "No recent snapshots for this factor's strategies."
                              : `Signal data covers ${fmtPct(f.coverage * 100)} of invested value${
                                  f.asOf ? ` · as of ${fmtDate(f.asOf)}` : ""
                                }`}
                          </p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-faint">
                  Each holding&apos;s score percentile within a strategy&apos;s universe is
                  averaged across the factor&apos;s strategies, then weighted by invested
                  value. Momentum: S100, S172, S174, ROC20, 52w-low · Value: S099,
                  S076, S078, S080, S081 · Quality: S18 · Low volatility: S101.
                  Holdings missing from a snapshot are excluded (coverage shown).
                </p>
              </section>
            </div>

            <section
              className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6"
              aria-label="Holdings"
            >
              <h2 className="text-base font-semibold tracking-tight text-paper">
                Holdings
              </h2>
              <DataTable
                columns={[
                  {
                    key: "symbol",
                    label: "Symbol",
                    sortable: true,
                    sticky: true,
                    widthPx: 120,
                    render: (h) => (
                      <span className="font-mono text-paper">{h.symbol}</span>
                    ),
                  },
                  {
                    key: "name",
                    label: "Name",
                    sortable: true,
                    render: (h) => (
                      <span className="text-muted">{h.resolved?.name ?? "Not in index"}</span>
                    ),
                  },
                  {
                    key: "qty",
                    label: "Qty",
                    align: "right",
                    sortable: true,
                    sortValue: (h) => h.qty,
                    render: (h) => (
                      <span className="font-mono text-muted">{fmtQty.format(h.qty)}</span>
                    ),
                  },
                  {
                    key: "avgPrice",
                    label: "Avg price",
                    align: "right",
                    sortable: true,
                    sortValue: (h) => h.avgPrice,
                    render: (h) => (
                      <span className="font-mono text-muted">{fmtPrice.format(h.avgPrice)}</span>
                    ),
                  },
                  {
                    key: "value",
                    label: "Invested",
                    align: "right",
                    sortable: true,
                    sortValue: (h) => h.value,
                    render: (h) => <span className="font-mono text-paper">{fmtInr.format(h.value)}</span>,
                  },
                  {
                    key: "sector",
                    label: "Sector",
                    sortable: true,
                    render: (h) => <span className="text-muted">{h.resolved?.sector ?? "—"}</span>,
                  },
                  {
                    key: "cap",
                    label: "Cap",
                    sortable: true,
                    render: (h) => <span className="text-muted">{h.resolved?.cap ?? "—"}</span>,
                  },
                  {
                    key: "nifty50",
                    label: "Nifty 50",
                    align: "center",
                    sortable: true,
                    sortValue: (h) => (h.resolved?.nifty50 ? 1 : 0),
                    render: (h) =>
                      h.resolved?.nifty50 ? (
                        <span className="text-xs text-up">Member</span>
                      ) : (
                        <span className="text-faint">—</span>
                      ),
                  },
                ]}
                rows={holdingsRows}
                rowKey={(h) => h.symbol}
                empty="Import a CSV to see holdings."
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={(k, d) => {
                  setSortKey(k);
                  setSortDir(d);
                }}
              />
              <p className="mt-3 text-sm text-muted">
                Total invested:{" "}
                <span className="font-mono text-paper">{fmtInr.format(totalValue)}</span>{" "}
                across <span className="font-mono">{imported.length}</span> holding
                {imported.length === 1 ? "" : "s"}.
              </p>
            </section>
          </>
        )}

        <p className="text-[11px] leading-relaxed text-faint">
          Holdings live in <span className="font-mono">{PORTFOLIO_KEY}</span> in this
          browser only — nothing is uploaded. Quotes and signal snapshots are read
          from public endpoints; the CSV itself never leaves your machine. Not
          investment advice.
        </p>
      </main>
    </div>
  );
}