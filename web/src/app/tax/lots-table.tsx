"use client";

import type { TaxConfig, TaxLot } from "@/lib/taxLots";
import { fmtInr, fmtNum, lotTax } from "@/lib/taxLots";

interface Props {
  lots: TaxLot[];
  config: TaxConfig;
  asOf: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function LotsTable({ lots, config, asOf, selected, onToggle, onDelete }: Props) {
  if (lots.length === 0) {
    return (
      <section aria-labelledby="lots-heading" className="rounded-lg border border-dashed border-line bg-surface p-8 text-center shadow-sm">
        <h2 id="lots-heading" className="text-sm font-semibold text-paper">
          Lots
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          No lots yet. Add your first buy transaction above — the planner splits its gain into
          STCG and LTCG and counts down to the long-term anniversary.
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="lots-heading" className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 id="lots-heading" className="text-sm font-semibold text-paper">
          Lots
        </h2>
        <p className="text-xs text-muted">
          <span className="font-mono tabular-nums">{String(lots.length).padStart(2, "0")}</span> lots
        </p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs text-muted">
              <th scope="col" className="w-8 px-4 py-2 font-medium">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="px-2 py-2 font-medium">Symbol</th>
              <th scope="col" className="px-2 py-2 font-medium">Buy date</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Current</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Gain</th>
              <th scope="col" className="px-2 py-2 font-medium">Holding</th>
              <th scope="col" className="px-2 py-2 font-medium">LTCG countdown</th>
              <th scope="col" className="w-10 px-4 py-2 font-medium">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const t = lotTax(lot, asOf, config);
              const checked = selected.has(lot.id);
              const label = `${lot.symbol || "Untitled lot"} bought ${lot.buyDate}`;
              return (
                <tr key={lot.id} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Simulate sale of ${label}`}
                      checked={checked}
                      onChange={() => onToggle(lot.id)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </td>
                  <td className="px-2 py-2.5 font-medium text-paper">
                    {lot.symbol || <span className="text-faint">Untitled</span>}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs tabular-nums text-muted">{lot.buyDate}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtNum.format(lot.qty)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtNum.format(lot.avgPrice)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtNum.format(lot.currentPrice)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono text-xs font-semibold tabular-nums ${t.gain >= 0 ? "text-up" : "text-down"}`}>
                    {t.gain >= 0 ? "+" : ""}
                    {fmtInr.format(t.gain)}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                        t.longTerm
                          ? "border-line bg-accent-soft text-paper"
                          : "border-warn/30 bg-warn-soft text-warn"
                      }`}
                    >
                      {t.longTerm ? "LTCG" : "STCG"}
                    </span>
                    <span className="ml-1.5 font-mono text-[11px] tabular-nums text-faint">
                      {t.monthsHeld}m
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    {t.longTerm ? (
                      <span className="inline-flex rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-up">
                        Long term today
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 py-0.5 font-mono text-[11px] tabular-nums text-warn"
                        title={`Long-term on ${new Date(
                          new Date(lot.buyDate).getFullYear(),
                          new Date(lot.buyDate).getMonth() + config.holdingMonths,
                          new Date(lot.buyDate).getDate()
                        ).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                      >
                        LTCG in {t.daysToLtcg}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(lot.id)}
                      aria-label={`Delete ${label}`}
                      className="rounded-full px-2 py-1 text-xs text-faint transition-colors hover:bg-down-soft hover:text-down"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}