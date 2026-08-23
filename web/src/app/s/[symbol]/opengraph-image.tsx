import { ImageResponse } from "next/og";
import { getChart } from "@/lib/marketData";
import { findInstrument } from "@/lib/instruments";

/* TASK-48: raster per-symbol share card (1200x630 PNG) with live price,
 * day change and a close-series sparkline. Degrades to a clean branded card
 * when the quote chain is down. */

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
  let changeColor = "#94948d";
  let line: string | null = null;
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
        changeColor = pct >= 0 ? "#7bb662" : "#ff5032";
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
          background: "#0a0a0b",
          color: "#f4f4f1",
          border: "2px solid #26262a",
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
                background: "#f4f4f1",
                color: "#0a0a0b",
                fontSize: 28,
                fontWeight: 700,
                borderRadius: 12,
              }}
            >
              N
            </div>
            <div style={{ fontSize: 30, letterSpacing: 4, color: "#94948d" }}>NIFTY // TERM</div>
          </div>
          <div style={{ fontSize: 26, color: "#94948d" }}>{inst?.sec ?? "NSE"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 44, color: "#c6f534", letterSpacing: 3 }}>
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
              <path d={line} stroke="#c6f534" strokeWidth={3} fill="none" />
            </svg>
          ) : (
            <div style={{ fontSize: 30, color: "#80807b" }}>
              candles · volume · screener — nifty term
            </div>
          )}
        </div>
      </div>
    ),
    size
  );
}
