"use client";

/* TASK-1418 — strategy score columns for /compare: fetches the strategy
   registry once, then the latest signal_snapshots per strategy, keeping
   only strategies that have a score for at least one of the two symbols
   (missing sides render "—" honestly). Columns are ordered by jury rank;
   scores are 0–100, higher = stronger. */

import { useEffect, useState } from "react";

interface StrategyMeta {
  id: string;
  name: string;
  subtitle: string;
  juryRank: number | null;
}

interface SignalItem {
  symbol: string;
  score: number | null;
  rank: number | null;
}

interface SignalsResponse {
  strategy: { id: string; name: string; asOf: number | null };
  items: SignalItem[];
}

interface ScoreRow {
  id: string;
  name: string;
  subtitle: string;
  juryRank: number | null;
  scoreA: number | null;
  rankA: number | null;
  scoreB: number | null;
  rankB: number | null;
}

const MAX_COLUMNS = 6;

const asOfLabel = (unixSec: number | null): string | null => {
  if (unixSec === null || !Number.isFinite(unixSec)) return null;
  const d = new Date(unixSec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
  }).format(d);
};

export default function StrategyScores({
  symbolA,
  symbolB,
}: {
  symbolA: string;
  symbolB: string;
}) {
  const [rows, setRows] = useState<ScoreRow[] | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/strategies", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        const list = (json.strategies ?? []) as StrategyMeta[];
        const settled = await Promise.allSettled(
          list.map(async (s) => {
            const r = await fetch(
              `/api/signals?strategy=${encodeURIComponent(s.id)}&limit=50`,
              { cache: "no-store" },
            );
            if (!r.ok) throw new Error(String(r.status));
            return (await r.json()) as SignalsResponse;
          }),
        );
        if (cancelled) return;
        const out: ScoreRow[] = [];
        let latestAsOf: number | null = null;
        settled.forEach((res2, i) => {
          const meta = list[i];
          if (!meta || res2.status !== "fulfilled") return;
          const payload = res2.value;
          const items = payload.items ?? [];
          const fa = items.find((x) => x.symbol === symbolA);
          const fb = items.find((x) => x.symbol === symbolB);
          if ((fa?.score ?? null) === null && (fb?.score ?? null) === null) return;
          if (typeof payload.strategy?.asOf === "number") {
            latestAsOf = Math.max(latestAsOf ?? 0, payload.strategy.asOf);
          }
          out.push({
            id: meta.id,
            name: meta.name,
            subtitle: meta.subtitle,
            juryRank: meta.juryRank,
            scoreA: fa?.score ?? null,
            rankA: fa?.rank ?? null,
            scoreB: fb?.score ?? null,
            rankB: fb?.rank ?? null,
          });
        });
        out.sort(
          (x, y) =>
            (x.juryRank ?? Number.MAX_SAFE_INTEGER) -
            (y.juryRank ?? Number.MAX_SAFE_INTEGER),
        );
        setRows(out.slice(0, MAX_COLUMNS));
        setAsOf(latestAsOf);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [symbolA, symbolB, reloadKey]);

  if (failed) {
    return (
      <section aria-label="Strategy scores" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-paper">Strategy scores</h2>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setReloadKey((k) => k + 1);
            }}
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-paper"
          >
            Retry
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Strategy scores unavailable right now.</p>
      </section>
    );
  }

  const asOfDate = rows && rows.length > 0 ? asOfLabel(asOf) : null;

  return (
    <section aria-label="Strategy scores" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-paper">Strategy scores</h2>
        <span className="font-mono text-[11px] tabular-nums text-faint">
          {asOfDate ? `scores as of ${asOfDate}` : "0–100 · higher = stronger"}
        </span>
      </div>
      <p className="mt-1 text-xs text-faint">
        0–100, higher = stronger, within each strategy&apos;s own ranking. &ldquo;—&rdquo; = no
        snapshot for that symbol.
      </p>

      {rows === null && (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="block h-4 w-2/3 animate-pulse rounded bg-panel-2"
            />
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          No strategy snapshots on file for either symbol.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className="mt-3 hidden border-b border-line pb-2 md:grid md:grid-cols-[minmax(0,1fr)_7rem_7rem] md:gap-x-3">
            <span className="text-[11px] font-medium tracking-wide text-faint">Strategy</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{symbolA}</span>
            <span className="font-mono text-[11px] tracking-wide text-muted">{symbolB}</span>
          </div>
          <div className="mt-2">
            {rows.map((r, i) => {
              const cell = (score: number | null, rank: number | null) =>
                score === null ? (
                  <span className="font-mono text-sm tabular-nums text-faint">—</span>
                ) : (
                  <span className="font-mono text-sm tabular-nums text-paper">
                    {score.toFixed(1)}
                    <span className="ml-1.5 text-[11px] text-faint">#{rank ?? "?"}</span>
                  </span>
                );
              return (
                <div
                  key={r.id}
                  className={`grid grid-cols-1 gap-x-3 py-2.5 md:grid-cols-[minmax(0,1fr)_7rem_7rem] ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <p className="text-sm">
                    <span className="font-medium text-paper">{r.name}</span>
                    {r.juryRank !== null && (
                      <span className="ml-2 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[10px] leading-none text-faint">
                        jury #{r.juryRank}
                      </span>
                    )}
                    {r.subtitle && (
                      <span className="ml-2 hidden text-xs text-muted lg:inline">{r.subtitle}</span>
                    )}
                  </p>
                  <p>
                    <span className="mr-2 font-mono text-[11px] tabular-nums text-faint md:hidden">
                      {symbolA}
                    </span>
                    {cell(r.scoreA, r.rankA)}
                  </p>
                  <p>
                    <span className="mr-2 font-mono text-[11px] tabular-nums text-faint md:hidden">
                      {symbolB}
                    </span>
                    {cell(r.scoreB, r.rankB)}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}