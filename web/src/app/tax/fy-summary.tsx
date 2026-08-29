"use client";

import type { TaxConfig, TaxLot } from "@/lib/taxLots";
import { fmtInr, fmtNum, fySummary, lotsToCsv } from "@/lib/taxLots";

interface Props {
  lots: TaxLot[];
  config: TaxConfig;
  asOf: string;
}

export default function FySummary({ lots, config, asOf }: Props) {
  const rows = fySummary(lots, asOf, config);

  const download = () => {
    const blob = new Blob([lotsToCsv(lots, asOf, config)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nifty-tax-lots-${asOf}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="fy-heading" className="rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div>
          <h2 id="fy-heading" className="text-sm font-semibold text-paper">
            FY totals
          </h2>
          <p className="mt-1 text-xs text-muted">
            Gains grouped by financial year of purchase, classified with today&apos;s holding
            period and settings.
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          disabled={rows.length === 0}
          className="rounded-full bg-paper px-4 py-1.5 text-xs font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 pt-3 text-sm text-muted">Nothing to export yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs text-muted">
                <th scope="col" className="px-5 py-2 font-medium">Financial year</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Lots</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Invested</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Value</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Gain</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">STCG</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">LTCG</th>
                <th scope="col" className="px-5 py-2 text-right font-medium">Est. tax</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.fy} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2.5 font-mono text-xs tabular-nums text-paper">{r.fy}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{r.lots}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtNum.format(r.qty)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">{fmtInr.format(r.invested)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums text-muted">{fmtInr.format(r.value)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono text-xs font-semibold tabular-nums ${r.gain >= 0 ? "text-up" : "text-down"}`}>
                    {r.gain >= 0 ? "+" : ""}
                    {fmtInr.format(r.gain)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtInr.format(r.stcgGain)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{fmtInr.format(r.ltcgGain)}</td>
                  <td className="px-5 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-warn">{fmtInr.format(r.totalTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}