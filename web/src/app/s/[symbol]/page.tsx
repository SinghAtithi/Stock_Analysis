import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getChart } from "@/lib/marketData";
import { findInstrument } from "@/lib/instruments";

/* Per-symbol share landing (TASK-48): crawlers get full per-symbol OG meta +
 * raster card (/s/[symbol]/opengraph-image); humans land on the terminal
 * with the symbol preloaded via ?s=. */

const UP_SYM = (s: string) => decodeURIComponent(s).trim().toUpperCase();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: raw } = await params;
  const symbol = UP_SYM(raw);
  const inst = findInstrument(symbol);
  let priceLine = "Live candles, volume and key stats";
  let changeLine = "";
  try {
    const p = await getChart(symbol, "NSE", false, "1d", "5m");
    if (p?.regularMarketPrice != null) {
      const sign = (p.changePct ?? 0) >= 0 ? "+" : "";
      priceLine = `₹${p.regularMarketPrice.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
      changeLine = `${sign}${(p.changePct ?? 0).toFixed(2)}%`;
    }
  } catch {
    // card degrades gracefully without live quote
  }
  const title = `${inst?.n ?? symbol} (${symbol}) — NIFTY`;
  return {
    title,
    description: `${priceLine} ${changeLine} · NSE/BSE candles, volume and key stats on NIFTY.`,
    openGraph: {
      title,
      description: `${priceLine} ${changeLine}`.trim(),
      images: [`/s/${encodeURIComponent(symbol)}/opengraph-image`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [`/s/${encodeURIComponent(symbol)}/opengraph-image`],
    },
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  redirect(`/?s=${encodeURIComponent(UP_SYM(raw))}`);
}
