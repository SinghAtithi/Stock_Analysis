import type { Metadata } from "next";
import { findInstrument } from "@/lib/instruments";
import CompanyProfile from "./CompanyProfile";

/* Per-symbol company profile (TASK-58). Server wrapper owns SEO metadata +
 * share-card destination; the client child renders the data sections.
 * Card reuses the TASK-48 raster at /s/[symbol]/opengraph-image. */

const UP_SYM = (s: string) => decodeURIComponent(s).trim().toUpperCase();

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: raw } = await params;
  const symbol = UP_SYM(raw);
  const inst = findInstrument(symbol);
  const title = `${inst?.n ?? symbol} (${symbol}) — NIFTY`;
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
  const { symbol } = await params;
  return <CompanyProfile symbol={UP_SYM(symbol)} />;
}
