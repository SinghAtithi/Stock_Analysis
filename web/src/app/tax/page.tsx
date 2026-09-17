"use client";

import { useEffect, useState } from "react";
import type { TaxConfig, TaxLot } from "@/lib/taxLots";
import { TAX_CONFIG_KEY, TAX_DEFAULTS, TAX_LOTS_KEY, toISODate } from "@/lib/taxLots";
import AddLotForm from "./add-lot-form";
import TaxConfigPanel from "./tax-config-panel";
import LotsTable from "./lots-table";
import Simulator from "./simulator";
import FySummary from "./fy-summary";

function loadLots(): TaxLot[] {
  try {
    const raw = window.localStorage.getItem(TAX_LOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is TaxLot =>
        l &&
        typeof l.id === "string" &&
        typeof l.buyDate === "string" &&
        typeof l.qty === "number" &&
        typeof l.avgPrice === "number" &&
        typeof l.currentPrice === "number",
    );
  } catch {
    return [];
  }
}

function loadConfig(): TaxConfig {
  try {
    const raw = window.localStorage.getItem(TAX_CONFIG_KEY);
    if (!raw) return { ...TAX_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<TaxConfig>;
    return { ...TAX_DEFAULTS, ...parsed };
  } catch {
    return { ...TAX_DEFAULTS };
  }
}

export default function TaxPage() {
  const [lots, setLots] = useState<TaxLot[]>(() => (typeof window === "undefined" ? [] : loadLots()));
  const [config, setConfig] = useState<TaxConfig>(() =>
    typeof window === "undefined" ? { ...TAX_DEFAULTS } : loadConfig(),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asOf] = useState<string>(() => toISODate(new Date()));

  useEffect(() => {
    try {
      window.localStorage.setItem(TAX_LOTS_KEY, JSON.stringify(lots));
    } catch {}
  }, [lots]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TAX_CONFIG_KEY, JSON.stringify(config));
    } catch {}
  }, [config]);

  const addLot = (lot: Omit<TaxLot, "id">) => {
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLots((prev) => [...prev, { ...lot, id }]);
  };

  const deleteLot = (id: string) => {
    setLots((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const simLots = lots.filter((l) => selected.has(l.id));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">
          Tax lot planner
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Per-lot STCG/LTCG split under current rules, a holding-period countdown to the
          long-term anniversary, and a what-if sale simulator — all estimates, stored only in
          your browser.
        </p>
      </header>

      <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-xs leading-relaxed text-warn">
        <strong className="font-semibold">Estimates only.</strong> Holding-period thresholds,
        rates and the exemption are configurable in the settings panel and default to the
        current regime; the law changes, and brokerage, cess, surcharge and indexation nuances
        are ignored. This is a planning aid, not tax advice — consult a chartered accountant
        before filing. See the full{" "}
        <a href="/disclaimer" className="font-medium underline underline-offset-2 hover:opacity-80">
          disclaimer
        </a>
        .
      </div>

      <AddLotForm onAdd={addLot} />

      <TaxConfigPanel config={config} onChange={setConfig} />

      <LotsTable
        lots={lots}
        config={config}
        asOf={asOf}
        selected={selected}
        onToggle={toggleSelected}
        onDelete={deleteLot}
      />

      <Simulator lots={simLots} config={config} asOf={asOf} />

      <FySummary lots={lots} config={config} asOf={asOf} />

      <p className="text-[11px] leading-relaxed text-faint">
        Data lives in <span className="font-mono">{TAX_LOTS_KEY}</span> in this browser only —
        nothing is uploaded. Dates are taken as local time; the financial year runs April to
        March.
      </p>
    </div>
  );
}