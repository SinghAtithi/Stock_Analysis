/* TASK-66 probe: what does NSE quote-equity expose keyless (with session)?
 * Writes nothing; prints the metric-relevant keys we could map into
 * fundamentals.metrics_json. */
import { defaultBackoff, curlJson } from "../../lib/curl.mjs";
import { ensureNseSession } from "../../ingest-eod.mjs";

const jar = await ensureNseSession(defaultBackoff, console.log);
const sym = process.argv[2] ?? "RELIANCE";
const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(sym)}`;
try {
  const data = await curlJson(url, {
    cookieJar: jar,
    headers: {
      Referer: `https://www.nseindia.com/get-quotes-equity?symbol=${encodeURIComponent(sym)}`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o?.[k]]));
  console.log(JSON.stringify({
    symbol: data?.info?.symbol,
    sector: data?.metadata?.industry,
    mktCap: data?.priceInfo,
    pe: pick(data?.metadata ?? {}, ["pE", "industryPE", "bookValue", "priceBand"]),
    keyFields: pick(data ?? {}, ["totalTradedVolume", "deliveryToTradedQuantity"]),
    topKeys: Object.keys(data ?? {}).slice(0, 20),
  }, null, 1));
} catch (e) {
  console.error("probe failed:", e.message);
  process.exit(1);
}
