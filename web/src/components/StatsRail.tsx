"use client";

import type { ChartData } from "@/lib/types";
import { volumeCompact } from "@/lib/format";

export default function StatsRail({ data }: { data: ChartData }) {
  const candles = data.candles;
  const last = candles[candles.length - 1];
  const prevClose =
    data.previousClose ??
    (candles.length >= 2 ? candles[candles.length - 2].close : null);

  const cells: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: "OPEN", value: last ? last.open.toFixed(2) : "—" },
    { label: "HIGH", value: last ? last.high.toFixed(2) : "—" },
    { label: "LOW", value: last ? last.low.toFixed(2) : "—" },
    {
      label: "PREV CLOSE",
      value: prevClose != null ? prevClose.toFixed(2) : "—",
      tone:
        prevClose != null && last
          ? last.close >= prevClose
            ? "up"
            : "down"
          : undefined,
    },
    { label: "VOLUME", value: last ? volumeCompact(last.volume) : "—" },
    {
      label: "52W RANGE",
      value:
        data.fiftyTwoWeekLow != null
          ? `${data.fiftyTwoWeekLow.toFixed(0)} – ${data.fiftyTwoWeekHigh?.toFixed(0) ?? "—"}`
          : "—",
    },
  ];

  const band =
    data.fiftyTwoWeekLow != null &&
    data.fiftyTwoWeekHigh != null &&
    data.fiftyTwoWeekHigh > data.fiftyTwoWeekLow &&
    last
      ? Math.min(
          1,
          Math.max(
            0,
            (last.close - data.fiftyTwoWeekLow) /
              (data.fiftyTwoWeekHigh - data.fiftyTwoWeekLow),
          ),
        )
      : null;

  return (
    <div className="grid grid-cols-2 border border-hairline bg-panel sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`px-4 py-3 transition-colors duration-100 hover:bg-panel-2 ${
            i > 0 ? "border-l border-hairline" : ""
          } ${i >= 2 ? "border-t border-hairline sm:border-t-0" : ""} ${
            i >= 3 ? "lg:border-t-0" : ""
          }`}
        >
          <p className="font-mono text-[9px] tracking-[0.22em] text-faint">
            {c.label}
          </p>
          <p
            className={`mt-1 font-mono text-[15px] tabular-nums ${
              c.tone === "up"
                ? "text-up"
                : c.tone === "down"
                  ? "text-down"
                  : "text-paper"
            }`}
          >
            {c.value}
          </p>
          {band !== null && i === cells.length - 1 && (
            <div
              className="relative mt-1.5 h-[3px] bg-panel-2"
              role="img"
              aria-label={`Current price at ${Math.round(band * 100)}% of 52 week range`}
            >
              <span
                className="absolute top-1/2 h-[7px] w-[3px] -translate-x-1/2 -translate-y-1/2 bg-paper"
                style={{ left: `${band * 100}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
