"use client";

import type { ChartData } from "@/lib/types";
import { volumeCompact } from "@/lib/format";

export default function StatsRail({ data }: { data: ChartData }) {
  const candles = data.candles ?? [];
  const last = candles[candles.length - 1];
  const prevClose =
    data.previousClose ??
    (candles.length >= 2 ? candles[candles.length - 2].close : null);

  const cells: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: "Open", value: last ? last.open.toFixed(2) : "—" },
    { label: "High", value: last ? last.high.toFixed(2) : "—" },
    { label: "Low", value: last ? last.low.toFixed(2) : "—" },
    {
      label: "Prev close",
      value: prevClose != null ? prevClose.toFixed(2) : "—",
      tone:
        prevClose != null && last
          ? last.close >= prevClose
            ? "up"
            : "down"
          : undefined,
    },
    { label: "Volume", value: last ? volumeCompact(last.volume) : "—" },
    {
      label: "52W range",
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
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      aria-label="Session stats"
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm"
        >
          <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{c.label}</p>
          <p
            className={`mt-1 font-mono text-[15px] font-medium tabular-nums ${
              c.tone === "up"
                ? "text-up"
                : c.tone === "down"
                  ? "text-down"
                  : "text-paper"
            }`}
          >
            {c.value}
          </p>
          {band !== null && c.label === "52W range" && (
            <div
              className="relative mt-2 h-1 rounded-full bg-panel-2"
              role="img"
              aria-label={`Current price at ${Math.round(band * 100)}% of 52 week range`}
            >
              <span
                className="absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper"
                style={{ left: `${band * 100}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
