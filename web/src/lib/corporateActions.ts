/* Corporate-action markers for the chart — TASK-360.
 *
 * Pure module (no DOM, no lightweight-charts import) so the snap/describe
 * logic is unit-testable with node:test. The API route that feeds it is
 * /api/corporate-actions?symbol=RELIANCE.NS — symbols are exchange-suffixed.
 *
 * Ex-dates come back as IST-midnight epochs while Yahoo candle times are
 * UTC-midnight epochs (5h30m apart), so markers are snapped to the nearest
 * candle within a tolerance instead of requiring an exact time match.
 */

export type ActionKind = "dividend" | "split" | "bonus";

export interface CorporateActionItem {
  ts: number;
  type: string;
  ratio: number | null;
  subject: string | null;
}

export interface NormalizedAction extends CorporateActionItem {
  kind: ActionKind;
  /** short marker text drawn on the chart ("DIV", "SPLIT", "BONUS") */
  label: string;
  /** compact chip text ("DIV ₹8", "SPLIT 5:1", "BONUS 1:1") */
  short: string;
  /** plain-English annotation ("Dividend ₹8/share — price adjusted") */
  plain: string;
}

const KNOWN: Record<string, ActionKind> = {
  dividend: "dividend",
  split: "split",
  bonus: "bonus",
};

function dividendPlain(ratio: number | null): string {
  return ratio !== null
    ? `Dividend ₹${ratio}/share — price adjusted`
    : "Dividend — price adjusted";
}

function splitPlain(ratio: number | null): string {
  if (ratio === null || ratio <= 0) return "Split — price adjusted";
  return ratio >= 1
    ? `Split ${ratio}:1 — price adjusted`
    : `Split 1:${Math.round(1 / ratio)} — price adjusted`;
}

function bonusPlain(ratio: number | null): string {
  if (ratio === null || ratio <= 1) return "Bonus — price adjusted";
  return `Bonus 1:${Math.round(1 / (ratio - 1))} — price adjusted`;
}

function shortFor(kind: ActionKind, ratio: number | null): string {
  switch (kind) {
    case "dividend":
      return ratio !== null ? `DIV ₹${ratio}` : "DIV";
    case "split": {
      if (ratio === null || ratio <= 0) return "SPLIT";
      return ratio >= 1 ? `SPLIT ${ratio}:1` : `SPLIT 1:${Math.round(1 / ratio)}`;
    }
    case "bonus": {
      if (ratio === null || ratio <= 1) return "BONUS";
      return `BONUS 1:${Math.round(1 / (ratio - 1))}`;
    }
  }
}

const LABELS: Record<ActionKind, string> = {
  dividend: "DIV",
  split: "SPLIT",
  bonus: "BONUS",
};

export function normalizeAction(item: CorporateActionItem): NormalizedAction | null {
  const kind = KNOWN[item.type];
  if (!kind) return null;
  return {
    ...item,
    kind,
    label: LABELS[kind],
    short: shortFor(kind, item.ratio),
    plain:
      kind === "dividend"
        ? dividendPlain(item.ratio)
        : kind === "split"
          ? splitPlain(item.ratio)
          : bonusPlain(item.ratio),
  };
}

export function normalizeActions(items: CorporateActionItem[]): NormalizedAction[] {
  const out: NormalizedAction[] = [];
  for (const item of items) {
    const n = normalizeAction(item);
    if (n && Number.isFinite(n.ts)) out.push(n);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/* Keep markers inside the visible candle window, snapped to the nearest
 * candle time. snapDays is the max distance (in days) an ex-date may sit
 * from a candle before the marker is dropped — weekly/monthly candles need
 * a wider net than daily. Returns actions with `ts` rewritten to the
 * snapped candle time (candle times must be exact for the marker to draw). */
export function actionsInWindow(
  items: NormalizedAction[],
  candles: { time: number }[],
  snapDays: number,
): NormalizedAction[] {
  if (items.length === 0 || candles.length === 0) return [];
  const snapMs = snapDays * 86400 * 1000;
  const sorted = [...items].sort((a, b) => a.ts - b.ts);
  const out: NormalizedAction[] = [];
  for (const item of sorted) {
    let best: number | null = null;
    let bestDiff = Infinity;
    for (const c of candles) {
      const diff = Math.abs(item.ts * 1000 - c.time * 1000);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = c.time;
      }
      if (bestDiff === 0) break;
    }
    if (best !== null && bestDiff <= snapMs) {
      out.push({ ...item, ts: best });
    }
  }
  return out;
}

export interface ChartMarker {
  time: number;
  position: "belowBar";
  shape: "square" | "circle";
  color: string;
  text: string;
  id: string;
}

/* dividend = square, split/bonus = circle; all amber (warn token) so the
 * legend reads as one family: "price adjusted, not a crash". */
export function toMarkers(items: NormalizedAction[], color: string): ChartMarker[] {
  return items.map((a) => ({
    time: a.ts,
    position: "belowBar" as const,
    shape: a.kind === "dividend" ? ("square" as const) : ("circle" as const),
    color,
    text: a.label,
    id: `${a.ts}-${a.kind}`,
  }));
}

export async function fetchCorporateActions(
  symbol: string,
  signal?: AbortSignal,
): Promise<NormalizedAction[]> {
  try {
    const res = await fetch(
      `/api/corporate-actions?symbol=${encodeURIComponent(symbol)}`,
      { signal },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: CorporateActionItem[] };
    return normalizeActions(json.items ?? []);
  } catch {
    return [];
  }
}