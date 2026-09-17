"use client";

import type { TaxConfig } from "@/lib/taxLots";
import { TAX_DEFAULTS } from "@/lib/taxLots";

interface Props {
  config: TaxConfig;
  onChange: (next: TaxConfig) => void;
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-mono tabular-nums text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const labelCls = "block text-xs font-medium text-muted";

export default function TaxConfigPanel({ config, onChange }: Props) {
  const set = (patch: Partial<TaxConfig>) => onChange({ ...config, ...patch });

  const pct = (v: number) => `${(v * 100).toFixed(2)}`;

  return (
    <section aria-labelledby="settings-heading" className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="settings-heading" className="text-sm font-semibold text-paper">
            Tax settings
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Configurable — not hardcoded law. Defaults mirror the current regime; change them if
            the law or your situation does.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...TAX_DEFAULTS })}
          className="shrink-0 rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-muted transition-colors hover:text-paper"
        >
          Reset defaults
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cfg-holding-months" className={labelCls}>
            Holding threshold (months)
          </label>
          <input
            id="cfg-holding-months"
            type="number"
            min="1"
            step="1"
            className={inputCls}
            value={config.holdingMonths}
            onChange={(e) => set({ holdingMonths: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cfg-stcg-rate" className={labelCls}>
            STCG rate (%)
          </label>
          <input
            id="cfg-stcg-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className={inputCls}
            value={pct(config.stcgRate)}
            onChange={(e) => set({ stcgRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cfg-ltcg-rate" className={labelCls}>
            LTCG rate (%)
          </label>
          <input
            id="cfg-ltcg-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className={inputCls}
            value={pct(config.ltcgRate)}
            onChange={(e) => set({ ltcgRate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cfg-exemption" className={labelCls}>
            LTCG exemption (₹/FY)
          </label>
          <input
            id="cfg-exemption"
            type="number"
            min="0"
            step="1000"
            className={inputCls}
            value={config.ltcgExemption}
            onChange={(e) => set({ ltcgExemption: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className={labelCls}>STCG mode</span>
          <div className="flex rounded-full border border-line bg-panel-2 p-0.5 text-xs" role="group" aria-label="STCG mode">
            <button
              type="button"
              aria-pressed={config.stcgMode === "flat"}
              onClick={() => set({ stcgMode: "flat" })}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
                config.stcgMode === "flat" ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-paper"
              }`}
            >
              Flat rate
            </button>
            <button
              type="button"
              aria-pressed={config.stcgMode === "slab"}
              onClick={() => set({ stcgMode: "slab" })}
              className={`flex-1 rounded-full px-3 py-1.5 transition-colors ${
                config.stcgMode === "slab" ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-paper"
              }`}
            >
              Income slab
            </button>
          </div>
        </div>
        {config.stcgMode === "slab" && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="cfg-income" className={labelCls}>
                Annual income (₹)
              </label>
              <input
                id="cfg-income"
                type="number"
                min="0"
                step="10000"
                className={inputCls}
                value={config.income}
                onChange={(e) => set({ income: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className={labelCls}>Slab table (up to ₹ / rate %)</span>
              <div className="space-y-1">
                {config.stcgSlabRates.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="10000"
                      aria-label={`Slab ${i + 1} upper bound`}
                      className={inputCls}
                      disabled={!Number.isFinite(s.upTo)}
                      value={Number.isFinite(s.upTo) ? s.upTo : 0}
                      onChange={(e) => {
                        const next = [...config.stcgSlabRates];
                        next[i] = { ...s, upTo: Number(e.target.value) || 0 };
                        set({ stcgSlabRates: next });
                      }}
                    />
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      aria-label={`Slab ${i + 1} rate percent`}
                      className={inputCls}
                      value={pct(s.rate)}
                      onChange={(e) => {
                        const next = [...config.stcgSlabRates];
                        next[i] = { ...s, rate: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 };
                        set({ stcgSlabRates: next });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}