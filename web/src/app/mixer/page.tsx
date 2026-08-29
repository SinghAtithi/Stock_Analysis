"use client";

/* TASK-1377 — strategy mixer: pick jury-ranked strategies, weight them with
   sliders, and the server folds their signal_snapshots percentile ranks into
   one weighted composite. Mixes save as device-scoped named presets (own
   storage key — the screener preset schema can't hold weights). Free tier
   keeps 2 saved mixes; Pro is unlimited (TIER_LIMITS). */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import DataTable, { type Column } from "@/components/DataTable";
import {
  MAX_MIX_STRATEGIES,
  deleteMixPreset,
  getMixPresetsSnapshot,
  getServerMixPresetsSnapshot,
  normalizeWeights,
  restoreMixPreset,
  saveMixPreset,
  subscribeMixPresets,
  type MixPreset,
} from "@/lib/mixer";
import { TIER_LIMITS, tierForDevice } from "@/lib/tiers";
import { getDeviceId } from "@/lib/device";

interface StrategyMeta {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  juryRank: number | null;
  edgeScore: number | null;
  universe: string;
}

interface SubScore {
  strategyId: string;
  weight: number;
  percentile: number;
  score: number | null;
}

interface MixItem {
  symbol: string;
  name: string;
  sector: string | null;
  score: number | null;
  subScores: SubScore[];
}

interface MixMetaStrategy {
  strategyId: string;
  name: string;
  juryRank: number | null;
  weight: number;
  asOf: number | null;
  covered: number;
}

interface MixerResponse {
  meta: {
    count: number;
    limit: number;
    strategies: MixMetaStrategy[];
    coverage: { withAll: number; partial: number };
  };
  items: MixItem[];
}

const fmtDate = (t: number) =>
  new Date(t * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function MixerPage() {
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* raw slider values per picked strategy; only picked ids are present */
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [result, setResult] = useState<MixerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tier] = useState(() => tierForDevice(getDeviceId()));
  const mixLimit = TIER_LIMITS[tier].savedMixesMax;
  const unlimited = mixLimit >= 1000;

  const presets = useSyncExternalStore(
    subscribeMixPresets,
    getMixPresetsSnapshot,
    getServerMixPresetsSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ preset: MixPreset; index: number } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open && !naming) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, naming]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      setLoadError(null);
      try {
        const res = await fetch("/api/strategies");
        const json = await res.json();
        if (!cancelled && json.strategies?.length) setStrategies(json.strategies);
      } catch {
        if (!cancelled) setLoadError("Couldn't load the strategy registry.");
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /* top MAX_MIX_STRATEGIES jury-ranked strategies, unranked last */
  const ranked = [...strategies]
    .sort(
      (a, b) =>
        (a.juryRank ?? Number.MAX_SAFE_INTEGER) - (b.juryRank ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, MAX_MIX_STRATEGIES);

  const picked = ranked.filter((s) => weights[s.id] !== undefined);
  const weightArray = Object.entries(weights).map(([strategyId, weight]) => ({
    strategyId,
    weight,
  }));
  const normalized = normalizeWeights(weightArray);
  const allZero = picked.length > 0 && normalized.size === 0;
  const atCap = !unlimited && presets.length >= mixLimit;
  const nameExists = name.trim() !== "" && presets.some((p) => p.name === name.trim());
  const pendingOverwrite = confirmOverwrite && nameExists;

  const shortName = useCallback(
    (id: string): string => {
      const found = strategies.find((s) => s.id === id);
      if (!found) return id;
      return found.name.split(" ")[0] ?? found.name;
    },
    [strategies],
  );
  const fullName = useCallback(
    (id: string): string => strategies.find((s) => s.id === id)?.name ?? id,
    [strategies],
  );

  const toggleStrategy = (id: string) => {
    setWeights((prev) => {
      const next = { ...prev };
      if (next[id] !== undefined) delete next[id];
      else next[id] = 100;
      return next;
    });
    setResult(null);
  };

  const changeWeight = (id: string, raw: number) => {
    setWeights((prev) => ({ ...prev, [id]: raw }));
  };

  const run = useCallback(
    async (w: Record<string, number>) => {
      const entries = Object.entries(w).map(([strategyId, weight]) => ({
        strategyId,
        weight,
      }));
      if (entries.length === 0) {
        setError("Pick at least one strategy.");
        return;
      }
      if (!entries.some((e) => e.weight >= 0.5)) {
        setError("Set at least one weight above zero.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/mixer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategies: entries, limit: 50 }),
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          setError(json.error ?? "upstream failure");
          setResult(null);
          return;
        }
        setResult(json as MixerResponse);
      } catch {
        setError("network error");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || picked.length === 0) return;
    const exists = presets.some((p) => p.name === trimmed);
    if (exists && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    if (!exists && atCap) {
      flash(false, "Free plan keeps 2 saved mixes — delete one to make room");
      return;
    }
    const persisted = saveMixPreset(trimmed, weightArray);
    flash(
      persisted,
      persisted
        ? exists ? `Mix “${trimmed}” updated` : `Mix “${trimmed}” saved`
        : "Couldn't save mix — storage unavailable",
    );
    setName("");
    setConfirmOverwrite(false);
    setNaming(false);
  };

  const applyPreset = (p: MixPreset) => {
    const w: Record<string, number> = {};
    for (const { strategyId, weight } of p.weights) w[strategyId] = weight;
    setWeights(w);
    setResult(null);
    setOpen(false);
    void run(w);
  };

  const removePreset = (p: MixPreset) => {
    const index = presets.findIndex((x) => x.id === p.id);
    setPendingDelete({ preset: p, index });
    deleteMixPreset(p.id);
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setPendingDelete(null), 5000);
  };

  const columns: Column<MixItem>[] = [
    { key: "rank", label: "Rank", rank: true, width: "w-12", sticky: true, widthPx: 48 },
    { key: "symbol", label: "Symbol", sortable: true, width: "w-24", sticky: true, widthPx: 96 },
    { key: "name", label: "Company", sortable: true },
    {
      key: "score",
      label: "Composite",
      sortable: true,
      align: "right",
      width: "w-24",
      sortValue: (r) => r.score ?? -1,
      render: (r) =>
        r.score === null ? (
          "—"
        ) : (
          <span className="font-mono text-sm tabular-nums">{r.score.toFixed(1)}</span>
        ),
    },
    {
      key: "subScores",
      label: "Sub-scores",
      render: (r) =>
        r.subScores.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-wrap gap-1">
            {r.subScores.map((p) => (
              <span
                key={p.strategyId}
                title={`${fullName(p.strategyId)} · ${p.weight}% weight · percentile rank`}
                className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted"
              >
                {shortName(p.strategyId)} {p.percentile.toFixed(0)}
              </span>
            ))}
          </span>
        ),
    },
  ];

  const rows: MixItem[] = (result?.items ?? []).map((item, i) => ({
    ...item,
    rank: i + 1,
  }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">
          Strategy mixer
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Build your own jury composite — weight top-ranked strategies with
          sliders into a personal score. The composite is computed server-side
          from each strategy&apos;s latest signal snapshot as a weighted mean of
          percentile ranks. Mixes are saved per device; nothing is uploaded.
        </p>
      </header>

      <div ref={containerRef} className="flex flex-wrap items-center gap-2">
        {pendingDelete && (
          <span role="status" aria-live="polite" className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-muted">
            Deleted “{pendingDelete.preset.name}”
            <button
              type="button"
              onClick={() => {
                if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
                restoreMixPreset(pendingDelete.preset, pendingDelete.index);
                setPendingDelete(null);
              }}
              className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-paper transition-colors hover:border-line-strong"
            >
              Undo
            </button>
          </span>
        )}
        {notice && (
          <span
            role="status"
            aria-live="polite"
            className={`rounded-full px-2 py-0.5 text-xs ${notice.ok ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}
          >
            {notice.text}
          </span>
        )}
        {naming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmOverwrite(false);
              }}
              maxLength={40}
              placeholder="Mix name"
              aria-label="Mix name"
              className="w-40 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-paper focus-visible:outline-2 focus-visible:outline-accent"
            />
            {pendingOverwrite && (
              <span className="text-[11px] leading-tight text-down" role="alert">
                exists — overwrite?
              </span>
            )}
            <button
              type="submit"
              disabled={!name.trim() || picked.length === 0}
              className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pendingOverwrite ? "Overwrite" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setName("");
                setConfirmOverwrite(false);
              }}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:text-paper"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNaming(true);
              setConfirmOverwrite(false);
            }}
            disabled={picked.length === 0}
            className="rounded-full border border-dashed border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-line-strong hover:text-paper disabled:opacity-50"
          >
            Save mix
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-faint">
          Saved mixes {presets.length}
          {unlimited ? "" : ` / ${mixLimit} free`}
        </span>
        {presets.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="true"
              aria-label={`Saved mixes, ${presets.length} available`}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                open
                  ? "border-paper bg-paper text-ink shadow-sm"
                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
              }`}
            >
              Mixes ({presets.length})
            </button>
            {open && (
              <ul
                aria-label="Saved mixes"
                className="absolute right-0 z-20 mt-2 flex min-w-64 flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-md"
              >
                {presets.map((p) => (
                  <li key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => applyPreset(p)}
                      title={`${p.weights.length} strategies — ${p.weights
                        .map((w) => `${w.strategyId} ${w.weight}`)
                        .join(", ")}`}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm text-paper transition-colors hover:bg-panel-2"
                    >
                      {p.name}
                      <span className="ml-2 font-mono text-[11px] tabular-nums text-faint">
                        {p.weights.length} strategies
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removePreset(p)}
                      aria-label={`Delete saved mix ${p.name}`}
                      className="shrink-0 rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs text-muted transition-colors hover:text-down"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <section
        aria-labelledby="pick-heading"
        className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pick-heading" className="text-sm font-semibold text-paper">
            Pick strategies
          </h2>
          <p className="text-[11px] leading-tight text-faint">
            Top {MAX_MIX_STRATEGIES} jury-ranked strategies — the rest are left
            out so composites stay legible.
          </p>
        </div>
        {loadError && (
          <p className="mt-3 flex items-center gap-2 text-xs text-down">
            {loadError}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11px] font-medium text-paper transition-colors hover:border-line-strong"
            >
              Retry
            </button>
          </p>
        )}
        {ranked.length === 0 && !loadError ? (
          <p className="mt-3 text-xs text-faint">Loading the strategy registry…</p>
        ) : (
          <ul className="mt-3 divide-y divide-line/70">
            {ranked.map((s) => {
              const checked = weights[s.id] !== undefined;
              return (
                <li key={s.id} className="flex items-start gap-3 py-2.5">
                  <input
                    id={`pick-${s.id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStrategy(s.id)}
                    className="mt-1.5 h-4 w-4 shrink-0"
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                  <label
                    htmlFor={`pick-${s.id}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-paper">{s.name}</span>
                      <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">
                        {s.juryRank != null ? `Jury #${s.juryRank}` : "Unranked"}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-faint">
                        Edge {s.edgeScore != null ? s.edgeScore.toFixed(1) : "—"}/10
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                      {s.subtitle}
                      {s.universe ? (
                        <span className="text-faint"> · {s.universe}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="weights-heading"
        className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="weights-heading" className="text-sm font-semibold text-paper">
            Weights
          </h2>
          {picked.length > 0 && (
            <span
              role="status"
              aria-live="polite"
              className={`font-mono text-xs tabular-nums ${
                allZero ? "text-down" : "text-muted"
              }`}
            >
              {allZero ? "sum 0 — nothing weighted" : `normalized sum ${[...normalized.values()].reduce((a, b) => a + b, 0)}`}
            </span>
          )}
        </div>
        {picked.length === 0 ? (
          <p className="mt-3 text-xs text-faint">
            Pick strategies above to weight them — weights are normalized to sum
            100.
          </p>
        ) : allZero ? (
          <p className="mt-3 text-xs text-down" role="status">
            Set at least one weight above zero — zeroed strategies drop out of
            the mix.
          </p>
        ) : null}
        {picked.length > 0 && (
          <ul className="mt-3 space-y-3">
            {picked.map((s) => {
              const raw = weights[s.id];
              const eff = normalized.get(s.id);
              const zeroed = raw < 0.5;
              return (
                <li key={s.id} className={zeroed ? "opacity-60" : ""}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <label
                      htmlFor={`mix-w-${s.id}`}
                      className="min-w-0 text-sm text-paper"
                    >
                      {s.name}
                      <span className="ml-2 font-mono text-[11px] tabular-nums text-faint">
                        Jury #{s.juryRank ?? "—"}
                      </span>
                    </label>
                    <span className="flex items-center gap-2 font-mono text-xs tabular-nums">
                      <span className={zeroed ? "text-faint line-through" : "text-muted"}>
                        {raw}
                      </span>
                      <span className="w-16 text-right text-paper">
                        {eff !== undefined ? `${eff}%` : zeroed ? "removed" : "—"}
                      </span>
                    </span>
                  </div>
                  <input
                    id={`mix-w-${s.id}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={raw}
                    onChange={(e) => changeWeight(s.id, Number(e.target.value))}
                    aria-label={`${s.name} weight`}
                    aria-valuetext={`${raw} of 100, ${eff !== undefined ? `${eff}% of the mix` : "removed from the mix"}`}
                    className="mt-1.5 h-2 w-full cursor-pointer"
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run(weights)}
          disabled={picked.length === 0 || allZero || loading}
          className="rounded-full bg-paper px-5 py-2 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Building…" : "Build composite"}
        </button>
        {error && (
          <span role="alert" className="text-xs text-down">
            {error}
          </span>
        )}
        {!unlimited && atCap && picked.length > 0 && !naming && (
          <span className="text-[11px] leading-tight text-muted">
            Free plan keeps {mixLimit} saved mixes — delete one to save another.{" "}
            <a href="/pricing" className="underline decoration-line underline-offset-2 hover:text-paper">
              Pricing
            </a>
          </span>
        )}
      </div>

      {result && (
        <section aria-labelledby="composite-heading" className="space-y-2">
          <h2 id="composite-heading" className="text-sm font-semibold text-paper">
            Composite — {result.meta.count} symbols
          </h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {result.meta.strategies.map((s) => (
              <li key={s.strategyId} className="text-[11px] text-muted">
                <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono tabular-nums">
                  Jury #{s.juryRank ?? "—"} {s.name} · {s.weight}%
                </span>
                <span className="ml-1.5 text-faint">
                  {s.asOf !== null ? `as of ${fmtDate(s.asOf)}` : "no snapshots yet — excluded"}
                </span>
              </li>
            ))}
          </ul>
          {result.meta.coverage.partial > 0 && (
            <p className="text-[11px] leading-tight text-muted">
              {result.meta.coverage.partial} symbols are missing data from at
              least one strategy — their composite uses only the strategies that
              cover them.
            </p>
          )}
          <p className="sr-only">
            Composite scores are the weighted mean of each strategy&apos;s
            percentile rank, computed server-side from the latest signal
            snapshot.
          </p>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.symbol}
            empty={
              result.meta.strategies.every((s) => s.covered === 0)
                ? "No signal snapshots for these strategies yet — run signals first."
                : "No symbols in the overlap yet."
            }
            loading={false}
          />
        </section>
      )}
    </div>
  );
}