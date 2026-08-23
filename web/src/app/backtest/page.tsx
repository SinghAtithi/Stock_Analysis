"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import { computeSeriesMetrics } from "@/lib/backtest/metrics";
import { getDeviceId } from "@/lib/device";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";

/* /backtest — run the engine over eod_candles + signal history (TASK-28).
 * Form → POST /api/backtest (inline run, seconds) → equity curve vs
 * benchmark + run history. Deep-linkable via ?strategy=S100. */

interface StrategyMeta {
  id: string;
  name: string;
  juryRank: number | null;
}

interface EquityPoint {
  date: string;
  strat: number;
  bench: number;
}

interface RunResult {
  id: string;
  status: string;
  config: { strategyId: string; universe: string; topN: number; startDate: string; endDate?: string };
  totalTurnover: number;
  investedDays: number;
  rebalanceDates: number;
  equity: EquityPoint[];
  warning?: string;
}

interface RunSummary {
  id: string;
  strategyId: string;
  status: string;
  createdAt: number | null;
  config: { startDate?: string; endDate?: string } | null;
  metrics: { cagr?: number | null; sharpe?: number | null; maxDrawdown?: number | null } | null;
}

/* structured so cap errors can carry a Pricing CTA without changing copy paths */
interface ErrorInfo {
  text: string;
  showPricing?: boolean;
}

const DAY_LABEL_LIMIT = 3;

function fmtWait(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}m`;
  return `${Math.ceil(sec / 3600)}h`;
}

const COST_PRESETS = [
  { label: "Zero cost", cost: 0, slippage: 0 },
  { label: "Low (10 bps)", cost: 0.05, slippage: 0.05 },
  { label: "Realistic (20 bps)", cost: 0.15, slippage: 0.05 },
];

function defaultStart(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
}

export default function BacktestPage() {
  return (
    <Suspense>
      <BacktestInner />
    </Suspense>
  );
}

function BacktestInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [universe, setUniverse] = useState("nifty50");
  const [start, setStart] = useState(defaultStart());
  const [end, setEnd] = useState("");
  const [preset, setPreset] = useState(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const stratSeries = useRef<ISeriesApi<"Line"> | null>(null);
  const benchSeries = useRef<ISeriesApi<"Line"> | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/backtest");
      if (!res.ok) return;
      const json = await res.json();
      setHistory(Array.isArray(json.runs) ? json.runs : []);
    } catch {
      /* history is best-effort */
    }
  }, []);

  /* deep link: /backtest?id=<run> loads a persisted run; bad ids degrade
     back to the form-only view with a soft note */
  const runId = params.get("id");
  const loadRun = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`/api/backtest?id=${encodeURIComponent(runId)}`);
      if (!res.ok) {
        setResult(null);
        setError({ text: "That run could not be loaded — it may have been removed." });
        return;
      }
      const json = await res.json();
      setError(null);
      setResult(json as RunResult);
    } catch {
      setError({ text: "That run could not be loaded." });
    }
  }, [runId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadRun sets state only after awaits
    void loadRun();
  }, [loadRun]);

  function openRun(id: string, strategy: string) {
    router.replace(`/backtest?strategy=${encodeURIComponent(strategy)}&id=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  }

  /* TASK-95: drop one noisy run — optimistic locally, DELETE best-effort */
  const removeRun = useCallback(async (id: string) => {
    setHistory((prev) => prev.filter((r) => r.id !== id));
    try {
      await fetch(`/api/backtest?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* row already dropped locally; next reload reconciles */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/strategies");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.strategies?.length) return;
        setStrategies(json.strategies);
        const wanted = params.get("strategy");
        setStrategyId(
          wanted && json.strategies.some((s: StrategyMeta) => s.id === wanted)
            ? wanted
            : json.strategies[0].id
        );
      } catch {
        /* picker stays empty; form disabled */
      }
      if (!cancelled) await loadHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [params, loadHistory]);

  /* equity curve — created when the container mounts with the first result */
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const dark = document.documentElement.classList.contains("dark");
    const text = dark ? "#9ba1ac" : "#6b7280";
    const grid = dark ? "rgba(255,255,255,0.05)" : "rgba(17,18,20,0.05)";
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    chartApi.current = chart;
    stratSeries.current = chart.addSeries(LineSeries, {
      color: dark ? "#8ec9a8" : "#0e7a3a",
      lineWidth: 2,
      title: "Strategy",
    });
    benchSeries.current = chart.addSeries(LineSeries, {
      color: dark ? "#858b91" : "#9aa0a8",
      lineWidth: 1,
      lineStyle: 2,
      title: "Benchmark",
    });
    if (result?.equity?.length) {
      stratSeries.current.setData(result.equity.map((p) => ({ time: p.date, value: p.strat })));
      benchSeries.current.setData(result.equity.map((p) => ({ time: p.date, value: p.bench })));
      chart.timeScale().fitContent();
    }
    return () => {
      chart.remove();
      chartApi.current = null;
      stratSeries.current = null;
      benchSeries.current = null;
    };
  }, [result]);

  const runBacktest = useCallback(async () => {
    if (!strategyId || running) return;
    setRunning(true);
    setError(null);
    try {
      const p = COST_PRESETS[preset];
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          strategyId,
          universe,
          start,
          end: end || undefined,
          top: 10,
          cost: p.cost,
          slippage: p.slippage,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        /* cap 429 (tiers.ts gate): clear copy + Pricing CTA + retry hint;
           every other path keeps its original message */
        if (json.error === "daily_cap_reached") {
          const header = Number(res.headers.get("Retry-After"));
          const retryAfterSec =
            Number.isFinite(header) && header > 0
              ? header
              : typeof json.retryAfterSec === "number" && json.retryAfterSec > 0
                ? json.retryAfterSec
                : null;
          const limit = typeof json.limit === "number" && json.limit > 0 ? json.limit : DAY_LABEL_LIMIT;
          setError({
            text: `Free plan allows ${limit} backtest runs per 24h${
              retryAfterSec !== null ? ` — next slot in ~${fmtWait(retryAfterSec)}` : " — try again later"
            }.`,
            showPricing: true,
          });
          return;
        }
        setError(
          json.error === "unknown_strategy"
            ? { text: "Unknown strategy." }
            : json.error === "no_candles"
              ? { text: "No candle data for this universe — run the EOD ingest first." }
              : json.error === "db_unavailable"
                ? { text: "Database unavailable." }
                : { text: "Invalid backtest request." }
        );
        return;
      }
      setResult(json as RunResult);
      loadHistory();
      router.replace(
        `/backtest?strategy=${encodeURIComponent(strategyId)}&id=${encodeURIComponent((json as RunResult).id)}`,
        { scroll: false }
      );
    } catch {
      setError({ text: "Backtest failed to run." });
    } finally {
      setRunning(false);
    }
  }, [strategyId, universe, start, end, preset, running, loadHistory, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void runBacktest();
  }

  function fmtPct(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    return `${(v * 100).toFixed(2)}%`;
  }

  /* TASK-94 headline metrics — computed from the returned equity series so a
     fresh POST run and a deep-linked ?id= run render identical stats
     (labels match the BacktestEvidence strip on /screener). */
  const headline = useMemo(
    () =>
      result
        ? computeSeriesMetrics(result.equity.map((p) => ({ date: p.date, value: p.strat })))
        : null,
    [result]
  );
  /* TASK-254: benchmark side of the sr-only summary — same math, bench series */
  const benchHeadline = useMemo(
    () =>
      result
        ? computeSeriesMetrics(result.equity.map((p) => ({ date: p.date, value: p.bench })))
        : null,
    [result]
  );
  const fmtPct1 = (v: number | null): string =>
    v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;

  /* TASK-95: human strategy names for history rows (registry may still be
     loading or the id unknown — raw id is the fallback) */
  const strategyNames = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const nameOf = (id: string): string => strategyNames.get(id) ?? id;
  const fmtSharpe = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(2);

  return (
    <div className="min-h-dvh">
      <SiteHeader subtitle="Backtest" subtitleClassName="font-normal text-muted" />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
        <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Strategy backtest</h1>
        <form
          onSubmit={submit}
          className="grid gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
        >
          <label className="grid gap-1 text-sm lg:col-span-2">
            <span className="text-xs font-medium tracking-wide text-faint">Strategy</span>
            <select
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.juryRank !== null ? `#${s.juryRank} ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium tracking-wide text-faint">Universe</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            >
              <option value="nifty50">NIFTY 50</option>
              <option value="nifty500">NIFTY 500</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium tracking-wide text-faint">From</span>
            <input
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm tabular-nums"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium tracking-wide text-faint">To</span>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm tabular-nums"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium tracking-wide text-faint">Costs</span>
            <select
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value))}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            >
              {COST_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end lg:col-span-2">
            <button
              type="submit"
              disabled={running || !strategyId}
              className="w-full rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              {running ? "Running…" : "Run backtest"}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-faint lg:col-span-4">
            Monthly-rebalanced equal-weight top-N portfolio scored from signal snapshots.
            Runs on split-adjusted daily candles; benchmark is an equal-weight index recenters daily.
          </p>
        </form>

        {error && (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            <span className="flex-1">
              {error.text}
              {error.showPricing && (
                <>
                  {" "}
                  <Link
                    href="/pricing"
                    className="font-medium underline decoration-line underline-offset-2 hover:text-muted"
                  >
                    See Pricing
                  </Link>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => void (runId ? loadRun() : runBacktest())}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-panel-2"
            >
              Retry
            </button>
          </div>
        )}

        {result && (
          <section className="mt-6 grid gap-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <Metric label="CAGR" value={headline ? fmtPct1(headline.cagr) : "—"} />
              <Metric label="Sharpe" value={headline?.sharpe != null && Number.isFinite(headline.sharpe) ? headline.sharpe.toFixed(2) : "—"} />
              <Metric label="maxDD" value={headline ? fmtPct1(headline.maxDrawdown) : "—"} />
              <Metric label="Turnover total" value={fmtPct(result.totalTurnover)} />
              <Metric label="Rebalances" value={String(result.rebalanceDates)} />
              <Metric label="Invested days" value={String(result.investedDays)} />
              <Metric
                label="Window"
                value={`${result.config.startDate}${result.config.endDate ? ` – ${result.config.endDate}` : " – now"}`}
              />
            </div>
            {result.warning && (
              <p className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--color-line)" }}>
                {result.warning}
              </p>
            )}
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              {/* TASK-254: visible legend — token-driven so it tracks both
                  themes; green-vs-gray also reads without color vision */}
              <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span aria-hidden className="h-0.5 w-4 rounded-full bg-up" />
                  {nameOf(strategyId)}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span aria-hidden className="h-0.5 w-4 rounded-full bg-muted" />
                  Benchmark
                </span>
              </div>
              {/* TASK-254: figure+figcaption names the curve without role="img"
                  — the chart lib injects an anchor internally, which would make
                  an img container a nested-interactive violation */}
              <figure>
                <div
                  ref={chartRef}
                  className="h-[380px] w-full"
                />
                <figcaption className="sr-only">
                  Equity curve, {nameOf(strategyId)} versus benchmark,
                  window {result.config.startDate}
                  {result.config.endDate ? ` to ${result.config.endDate}` : " to present"}.
                  Strategy CAGR {fmtPct1(headline?.cagr ?? null)}, benchmark CAGR{" "}
                  {fmtPct1(benchHeadline?.cagr ?? null)}. Full metrics in the summary table.
                </figcaption>
              </figure>
              <table className="sr-only">
                <caption>Backtest summary, {nameOf(strategyId)} vs benchmark</caption>
                <thead>
                  <tr>
                    <th scope="col">Series</th>
                    <th scope="col">Final equity</th>
                    <th scope="col">CAGR</th>
                    <th scope="col">Sharpe</th>
                    <th scope="col">Max drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{nameOf(strategyId)}</th>
                    <td>{headline ? fmtPct1(headline.totalReturn) : "—"}</td>
                    <td>{fmtPct1(headline?.cagr ?? null)}</td>
                    <td>{fmtSharpe(headline?.sharpe)}</td>
                    <td>{fmtPct1(headline?.maxDrawdown ?? null)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Benchmark</th>
                    <td>{benchHeadline ? fmtPct1(benchHeadline.totalReturn) : "—"}</td>
                    <td>{fmtPct1(benchHeadline?.cagr ?? null)}</td>
                    <td>{fmtSharpe(benchHeadline?.sharpe)}</td>
                    <td>{fmtPct1(benchHeadline?.maxDrawdown ?? null)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <ul className="mt-3 grid gap-2">
            {history.length === 0 && <li className="text-sm text-muted">No runs yet.</li>}
            {history.slice(0, 12).map((r) => (
              <li
                key={r.id}
                className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => openRun(r.id, r.strategyId)}
                  className="min-w-0 flex-1 text-left transition-colors hover:text-muted"
                  aria-label={`Load backtest run ${nameOf(r.strategyId)} from ${r.config?.startDate ?? "unknown"}`}
                >
                  <span className="font-medium">{nameOf(r.strategyId)}</span>
                  <span className="ml-2 font-mono text-xs tabular-nums text-faint">{r.strategyId}</span>
                  <span className="ml-3 text-muted tabular-nums">
                    {r.config?.startDate ?? "—"}
                    {r.config?.endDate ? ` – ${r.config.endDate}` : ""}
                  </span>
                </button>
                <span className="font-mono tabular-nums" aria-label="CAGR">{fmtPct(r.metrics?.cagr ?? null)} CAGR</span>
                <span className="font-mono tabular-nums text-muted" aria-label="Sharpe">Sharpe {fmtSharpe(r.metrics?.sharpe)}</span>
                <span className="font-mono tabular-nums text-muted" aria-label="Max drawdown">maxDD {fmtPct1(r.metrics?.maxDrawdown ?? null)}</span>
                <span className="text-xs uppercase tracking-wide text-faint">{r.status}</span>
                <Link
                  href={`/screener?strategy=${encodeURIComponent(r.strategyId)}`}
                  className="rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-line-strong hover:text-paper"
                >
                  Screener →
                </Link>
                <button
                  type="button"
                  onClick={() => void removeRun(r.id)}
                  aria-label={`Remove backtest run from ${r.config?.startDate ?? "unknown"}`}
                  title="Remove run"
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-xs text-faint transition-colors hover:bg-down-soft hover:text-down"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">
            Past performance of a backtest does not predict live results.{" "}
            <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
              Not investment advice
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs font-medium tracking-wide text-faint">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
