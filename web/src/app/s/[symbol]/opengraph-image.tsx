import { ImageResponse } from "next/og";
import { getChart } from "@/lib/marketData";
import { findInstrument } from "@/lib/instruments";

/* TASK-48: raster per-symbol share card (1200x630 PNG) with live price,
 * day change and a close-series sparkline. Degrades to a clean branded card
 * when the quote chain is down.
 * TASK-1517: re-skinned to the UNSLOPIFY palette — quiet financial paper
 * (canvas/paper/ink), no neon-on-black. Values mirror globals.css tokens:
 * canvas #fcfcf9 · panel #ffffff · ink #111214 · muted #626870 ·
 * line #ece9e3 · up #0e7a3a · down #c4362b. ImageResponse can't read CSS
 * vars, so these literals are the token values, kept in one place. */

const C = {
  canvas: "#fcfcf9",
  panel: "#ffffff",
  ink: "#111214",
  muted: "#626870",
  faint: "#696f77",
  line: "#ece9e3",
  up: "#0e7a3a",
  down: "#c4362b",
} as const;

export const alt = "NIFTY — symbol share card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP_SYM = (s: string) => decodeURIComponent(s).trim().toUpperCase();

function sparkPath(closes: number[], w: number, h: number): string | null {
  if (closes.length < 2) return null;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  return closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((c - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default async function Image({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  const symbol = UP_SYM(raw);
  const inst = findInstrument(symbol);

  let priceText = "—";
  let changeText = "";
  let changeColor: string = C.muted;
  let line: string | null = null;
  let lineColor: string = C.up;
  try {
    const p = await getChart(symbol, "NSE", false, "3mo", "1d");
    if (p) {
      const closes = p.candles.map((c) => c.close).filter((c) => c != null);
      if (closes.length >= 2 && p.regularMarketPrice != null) {
        priceText = `₹${p.regularMarketPrice.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
        const pct = p.changePct ?? 0;
        changeText = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        changeColor = pct >= 0 ? C.up : C.down;
        lineColor = changeColor;
        line = sparkPath(closes.slice(-90), 900, 150);
      }
    }
  } catch {
    // upstream down — render branded fallback
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: C.canvas,
          color: C.ink,
          border: `2px solid ${C.line}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 52,
                height: 52,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: C.ink,
                color: C.canvas,
                fontSize: 28,
                fontWeight: 700,
                borderRadius: 12,
              }}
            >
              N
            </div>
            <div style={{ fontSize: 30, letterSpacing: 4, color: C.muted }}>NIFTY // TERM</div>
          </div>
          <div style={{ fontSize: 26, color: C.muted }}>{inst?.sec ?? "NSE"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 44, letterSpacing: 3, color: C.ink }}>
            {`${symbol} · ${inst?.n ?? symbol}`}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
            <div style={{ fontSize: 96, fontWeight: 700 }}>{priceText}</div>
            {changeText ? (
              <div style={{ fontSize: 48, color: changeColor, paddingBottom: 10 }}>{changeText}</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", height: 150 }}>
          {line ? (
            <svg width={1056} height={150} viewBox="0 0 900 150">
              <path d={line} stroke={lineColor} strokeWidth={3} fill="none" />
            </svg>
          ) : (
            <div style={{ fontSize: 30, color: C.faint }}>
              candles · volume · screener — nifty term
            </div>
          )}
        </div>
      </div>
    ),
    size
  );
}
