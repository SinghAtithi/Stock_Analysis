import type { MetadataRoute } from "next";
import instruments from "@/data/instruments.json" with { type: "json" };

/* TASK-48: sitemap from the instruments index — home, static pages, and one
 * entry per tradable symbol share card. */

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const statics = ["", "/screener", "/breadth", "/backtest", "/disclaimer", "/privacy", "/terms",
    "/help", "/help/getting-started", "/help/understanding-scores", "/help/plans-and-limits",
    "/help/data-and-delays", "/help/glossary"].map(
    (p) => ({
      url: `${BASE}${p}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: p === "" ? 1 : 0.6,
    })
  );
  const symbols = (instruments as Array<{ s: string }>).map((i) => ({
    /* canonical company URLs — /s/[symbol] 301s here, and crawlers should not
       index the redirect hop (TASK-128); share links keep working */
    url: `${BASE}/company/${encodeURIComponent(i.s)}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.5,
  }));
  return [...statics, ...symbols];
}
