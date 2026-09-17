"use client";

import type { TaxConfig, TaxLot } from "@/lib/taxLots";
import { fmtInr, lotTax, projectSale } from "@/lib/taxLots";

interface Props {
  lots: TaxLot[];
  config: TaxConfig;
  asOf: string;
}

function Row({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono text-sm tabular-nums ${cls}`}>{value}</dd>
    </div>
  );
}

export default function Simulator({ lots, config, asOf }: Props) {
  if (lots.length === 0) {
    return (
      <section aria-labelledby="sim-heading" className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 id="sim-heading" className="text-sm font-semibold text-paper">
          What-if sale
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Tick lots in the table to project STCG/LTCG tax and net proceeds before you sell.
        </p>
      </section>
    );
  }
  const p = projectSale(lots, asOf, config);
  return (
    <section aria-labelledby="sim-heading" className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sim-heading" className="text-sm font-semibold text-paper">
          What-if sale — {lots.length} lot{lots.length === 1 ? "" : "s"}
        </h2>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">
          Realizes in {p.realizedFy}
        </span>
      </div>
      <ul className="mt-3 space-y-1">
        {lots.map((lot) => {
          const t = lotTax(lot, asOf, config);
          return (
            <li key={lot.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-b-0">
              <span className="text-xs text-muted">
                {lot.symbol || "Untitled lot"}
                <span className="ml-1.5 font-mono tabular-nums">{lot.qty} @ {lot.avgPrice}</span>
              </span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {t.longTerm ? "LTCG" : "STCG"} {fmtInr.format(t.gain)}
              </span>
            </li>
          );
        })}
      </ul>
      <dl className="mt-3 space-y-1.5">
        <Row label="STCG gain" value={fmtInr.format(p.stcgGain)} cls="text-paper" />
        <Row label="STCG tax" value={fmtInr.format(p.stcgTax)} cls="text-paper" />
        <Row label="LTCG gain" value={fmtInr.format(p.ltcgGain)} cls="text-paper" />
        <Row label="LTCG tax (exemption applied once)" value={fmtInr.format(p.ltcgTax)} cls="text-paper" />
        <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
          <dt className="text-xs font-medium text-muted">Projected tax</dt>
          <dd className={`font-mono text-base font-semibold tabular-nums ${p.totalTax > 0 ? "text-warn" : "text-up"}`}>
            {fmtInr.format(p.totalTax)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs font-medium text-muted">Net proceeds</dt>
          <dd className="font-mono text-base font-semibold tabular-nums text-paper">{fmtInr.format(p.netProceeds)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Exemption is applied against the combined LTCG of the selected lots, per the settings
        panel. STCG in slab mode uses your configured income. Estimates only.
      </p>
    </section>
  );
}