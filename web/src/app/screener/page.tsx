"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import DataTable from "@/components/DataTable";
import type { Column } from "@/components/DataTable";

interface SignalItem {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  indices: string[];
  score: number;
  components: Record<string, number | string | null>;
  price: number | null;
  changePct: number | null;
}

interface SignalsResponse {
  strategy: {
    id: string;
    name: string;
    juryRank: number | null;
    edgeScore: number | null;
    asOf: number;
  };
  meta: { count: number; universe: string };
  items: SignalItem[];
}

interface StrategyMeta {
  id: string;
  name: string;
  category: string;
  juryRank: number | null;
  edgeScore: number | null;
  universe: string;
  inputs: string[];
  backtest?: {
    id: string;
    finishedAt: number | null;
    cagr: number | null;
    sharpe: number | null;
    maxDrawdown: number | null;
  } | null;
}

const FALLBACK_STRATEGIES: StrategyMeta[] = [
  { id: "demo-52wlow", name: "52W High Distance", category: "trend", juryRank: null, edgeScore: null, universe: "nifty500", inputs: [] },
  { id: "demo-roc20", name: "ROC(20) Momentum", category: "momentum", juryRank: null, edgeScore: null, universe: "nifty500", inputs: [] },
];

export default function ScreenerPage() {
  const [strategy, setStrategy] = useState<string>(FALLBACK_STRATEGIES[0].id);
  const [strategies, setStrategies] = useState<StrategyMeta[]>(FALLBACK_STRATEGIES);
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/strategies");
        const json = await res.json();
        if (!cancelled && json.strategies?.length) {
          setStrategies(json.strategies);
          /* honor ?strategy= deep links (screener ↔ backtest cross-links) */
          const wanted = new URLSearchParams(window.location.search).get("strategy");
          if (wanted && json.strategies.some((s: StrategyMeta) => s.id === wanted)) {
            setStrategy(wanted);
          }
        }
      } catch {
        /* fallback list stays */
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/signals?strategy=${encodeURIComponent(strategy)}&limit=50`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || json.error) {
          setError(json.error ?? "upstream failure");
          setData(null);
          return;
        }
        setData(json);
        setError(null);
      } catch {
        if (!cancelled) setError("network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  const items = data?.items ?? [];
  const meta = data?.strategy;

  const columns: Column<SignalItem>[] = [
    { key: "rank", label: "Rank", rank: true, width: "w-14" },
    { key: "symbol", label: "Symbol", sortable: true, width: "w-28" },
    { key: "name", label: "Company", sortable: true },
    { key: "sector", label: "Sector", sortable: true, width: "w-40" },
    {
      key: "score",
      label: "Score",
      sortable: true,
      align: "right",
      sortValue: (r) => r.score,
      width: "w-20",
      render: (r) => <span className="rounded-full bg-paper px-2 py-0.5 font-mono text-xs font-medium text-ink">{r.score.toFixed(1)}</span>,
    },
    {
      key: "price",
      label: "Price",
      sortable: true,
      align: "right",
      sortValue: (r) => r.price ?? -1,
      width: "w-24",
      render: (r) =>
        r.price != null ? (
          <span className="font-mono tabular-nums">{r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "changePct",
      label: "Day",
      sortable: true,
      align: "right",
      sortValue: (r) => r.changePct ?? 0,
      width: "w-20",
      render: (r) =>
        r.changePct != null ? (
          <span className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${r.changePct >= 0 ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
            {r.changePct >= 0 ? "+" : ""}
            {r.changePct.toFixed(2)}%
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Screener" subtitleClassName="font-normal text-muted" />

      <main id="main-content" className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Signal screener</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">Ranked signals from the strategy engine. Pick a strategy, sort the table, click a row to open the chart.</p>
          {meta && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-paper px-2.5 py-1 font-medium text-ink">{meta.name}</span>
              <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-muted">{meta.juryRank ? `Jury #${meta.juryRank}` : "Unranked"} · Edge {meta.edgeScore ?? "—"}/10</span>
              <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-faint">{data?.meta.count ?? 0} rows · {meta.asOf ? new Date(meta.asOf * 1000).toLocaleDateString("en-IN") : "—"}</span>
            </div>
          )}
          <BacktestEvidence strategy={strategies.find((s) => s.id === strategy)} />
        </div>

        <div role="group" aria-label="Strategy" className="flex flex-wrap items-center gap-2">
          {strategies.map((s) => (
            <button
              key={s.id}
              onClick={() => setStrategy(s.id)}
              aria-pressed={strategy === s.id}
              title={s.juryRank ? `${s.name} · jury #${s.juryRank} · edge ${s.edgeScore ?? "—"}/10` : `${s.name} · unranked`}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${strategy === s.id ? "border-paper bg-paper text-ink shadow-sm" : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"}`}
            >
              {s.name}
            </button>
          ))}
          <Link
            href={`/backtest?strategy=${encodeURIComponent(strategy)}`}
            className="ml-1 rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-paper"
          >
            Backtest →
          </Link>
        </div>

        {error && (
          <p className="rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            {error}
          </p>
        )}

        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.symbol}
          selectedKey={selected}
          onRowClick={(r) => {
            setSelected(r.symbol);
            /* exchange/type resolved server-side (TASK-51): the instruments
               index no longer ships to the client; a BSE-listed row must
               route as BSE (TASK-12), so resolve before navigating. */
            void (async () => {
              let exchange = "NSE";
              try {
                const res = await fetch(
                  `/api/instruments?s=${encodeURIComponent(r.symbol)}`,
                );
                if (res.ok) {
                  const json = await res.json();
                  if (json.instrument?.exchange) exchange = json.instrument.exchange;
                }
              } catch {
                /* fall back to NSE */
              }
              router.push(
                `/?s=${encodeURIComponent(r.symbol)}&e=${encodeURIComponent(exchange)}&r=1y`,
              );
            })();
          }}
          loading={loading}
          empty="No snapshots for this strategy yet"
        />

        <p className="text-xs leading-relaxed text-faint">
          Click a row to open the chart with <span className="font-mono">?s=SYMBOL</span> · Scores 0–100, higher is stronger · <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">Not investment advice</Link>
        </p>
      </main>
    </div>
  );
}

/* TASK-61 — latest completed backtest evidence for the selected strategy,
   straight from /api/strategies (single grouped query server-side). */
function BacktestEvidence({ strategy }: { strategy?: StrategyMeta }) {
  const bt = strategy?.backtest;
  if (!bt) {
    return (
      <p className="mt-2 text-xs leading-relaxed text-faint">
        No backtest yet for this strategy.{" "}
        <Link
          href={`/backtest?strategy=${encodeURIComponent(strategy?.id ?? "")}`}
          className="underline decoration-line underline-offset-2 hover:text-muted"
        >
          Run one →
        </Link>
      </p>
    );
  }
  const pct = (v: number | null, digits = 1): string =>
    v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <span className="font-medium tracking-wide text-faint uppercase">Backtest evidence</span>
      <span className="font-mono tabular-nums">CAGR {pct(bt.cagr)}</span>
      <span className="font-mono tabular-nums">Sharpe {bt.sharpe ?? "—"}</span>
      <span className="font-mono tabular-nums">maxDD {pct(bt.maxDrawdown)}</span>
      <Link
        href={`/backtest?id=${encodeURIComponent(bt.id)}`}
        className="ml-auto underline decoration-line underline-offset-2 hover:text-muted"
      >
        View run →
      </Link>
    </div>
  );
}
