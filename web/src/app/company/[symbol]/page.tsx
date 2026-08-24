import type { Metadata } from "next";
import { findInstrument, findInstrumentListing, isIndexSymbol, stripExchangeSuffix } from "@/lib/instruments";
import type { WatchlistEntry } from "@/lib/watchlist";
import CompanyProfile from "./CompanyProfile";

/* Per-symbol company profile (TASK-58). Server wrapper owns SEO metadata +
 * share-card destination; the client child renders the data sections.
 * Card reuses the TASK-48 raster at /s/[symbol]/opengraph-image.
 * TASK-80: the instruments index is resolved server-side so cross-nav
 * (chart deep-link, star, alerts) routes BSE symbols correctly. */

const UP_SYM = (s: string) => decodeURIComponent(s).trim().toUpperCase();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: rawMeta } = await params;
  /* TASK-358: suffixed links resolve to the bare symbol for metadata too */
  const { symbol } = stripExchangeSuffix(UP_SYM(rawMeta));
  const inst =
    (stripExchangeSuffix(UP_SYM(rawMeta)).impliedExchange &&
      findInstrumentListing(
        symbol,
        stripExchangeSuffix(UP_SYM(rawMeta)).impliedExchange!,
      )) ||
    findInstrument(symbol);
  const title = `${inst?.n ?? symbol} (${symbol}) — NIFTY//TERM`;
  return {
    title,
    description: `${inst?.n ?? symbol} fundamentals, analyst coverage, strategy memberships and corporate actions on NIFTY.`,
    openGraph: {
      title,
      description: `${symbol} · fundamentals, signals and corporate actions`,
      images: [`/s/${encodeURIComponent(symbol)}/opengraph-image`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [`/s/${encodeURIComponent(symbol)}/opengraph-image`],
    },
  };
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawParam } = await params;
  /* TASK-358: /company/RELIANCE.NS-style links resolve to the bare symbol
     and prefer the suffixed exchange's listing for quote lookups */
  const { symbol, impliedExchange } = stripExchangeSuffix(UP_SYM(rawParam));
  const inst =
    (impliedExchange && findInstrumentListing(symbol, impliedExchange)) ||
    findInstrument(symbol);
  const resolved: WatchlistEntry = {
    symbol,
    name: inst?.n ?? symbol,
    shortName: inst?.s ?? symbol,
    exchange: inst?.e ?? impliedExchange ?? "NSE",
    type: inst ? (isIndexSymbol(inst.s, inst.n) ? "Index" : "Equity") : symbol.includes("^") ? "Index" : "Equity",
    sector: inst?.sec ?? "",
  };
  return <CompanyProfile symbol={symbol} resolved={resolved} />;
}
