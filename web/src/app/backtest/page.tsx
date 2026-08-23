"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
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
  metrics: { cagr?: number | null } | null;
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
  const [error, setError] = useState<string | null>(null);
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
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/backtest?id=${encodeURIComponent(runId)}`);
        if (!res.ok) {
          if (!cancelled) {
            setResult(null);
            setError("That run could not be loaded — it may have been removed.");
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setError(null);
          setResult(json as RunResult);
        }
      } catch {
        if (!cancelled) setError("That run could not be loaded.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  function openRun(id: string, strategy: string) {
    router.replace(`/backtest?strategy=${encodeURIComponent(strategy)}&id=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  }

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!strategyId || running) return;
    setRunning(true);
    setError(null);
    try {
      const p = COST_PRESETS[preset];
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        setError(
          json.error === "unknown_strategy"
            ? "Unknown strategy."
            : json.error === "no_candles"
              ? "No candle data for this universe — run the EOD ingest first."
              : json.error === "db_unavailable"
                ? "Database unavailable."
                : "Invalid backtest request."
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
      setError("Backtest failed to run.");
    } finally {
      setRunning(false);
    }
  }

  function fmtPct(v: number | null | undefined): string {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    return `${(v * 100).toFixed(2)}%`;
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader subtitle="Backtest" subtitleClassName="font-normal text-muted" />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
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
          <p role="alert" className="mt-4 rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            {error}
          </p>
        )}

        {result && (
          <section className="mt-6 grid gap-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface p-5 shadow-sm">
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
              <div ref={chartRef} className="h-[380px] w-full" />
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Recent runs</h2>
          <ul className="mt-3 grid gap-2">
            {history.length === 0 && <li className="text-sm text-muted">No runs yet.</li>}
            {history.slice(0, 12).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openRun(r.id, r.strategyId)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-left text-sm shadow-sm transition-colors hover:border-line-strong"
                  aria-label={`Load backtest run ${r.strategyId} from ${r.config?.startDate ?? "unknown"}`}
                >
                  <span className="font-mono tabular-nums">{r.strategyId}</span>
                  <span className="text-muted tabular-nums">
                    {r.config?.startDate ?? "—"}
                    {r.config?.endDate ? ` – ${r.config.endDate}` : ""}
                  </span>
                  <span className="font-mono tabular-nums">{fmtPct(r.metrics?.cagr ?? null)} CAGR</span>
                  <span className="text-xs uppercase tracking-wide text-faint">{r.status}</span>
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
