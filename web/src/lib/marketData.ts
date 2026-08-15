import { execFile } from "child_process";
import { promisify } from "util";
import { findInstrument } from "@/lib/instruments";
import type { Candle, TickerItem } from "@/lib/types";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type JsonObject = Record<string, unknown>;

/* Yahoo TLS-fingerprints Node's undici and 429s it; curl passes. execFile: no shell. */
async function curlJson(url: string, extra: string[] = []): Promise<JsonObject> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sS",
      "-m",
      "20",
      "--compressed",
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      "Accept: application/json, text/plain, */*",
      ...extra,
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }
  );
  return JSON.parse(stdout) as JsonObject;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ---------- Yahoo ---------- */

let yahooCooldownUntil = 0;

async function yahooGet(url: string): Promise<JsonObject | null> {
  if (Date.now() < yahooCooldownUntil) return null;
  try {
    return await curlJson(url);
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    if (/429|Too Many Requests/.test(msg)) {
      yahooCooldownUntil = Date.now() + 60_000;
    }
    return null;
  }
}

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string
): Promise<JsonObject | null> {
  for (const host of ["query1", "query2"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
    const data = await yahooGet(url);
    if (data) return data;
  }
  return null;
}

/* ---------- Groww (fallback, equities only) ---------- */

const GROWW_RESOLUTION: Record<string, string | null> = {
  "1d": "daily",
  "5d": "daily",
  "1mo": "daily",
  "3mo": "daily",
  "6mo": "daily",
  "1y": "daily",
  "2y": "weekly",
  "5y": "weekly",
  max: "monthly",
};

/* candles kept after slicing (weekly for 2y/5y, monthly for max) */
const GROWW_WINDOW: Record<string, number> = {
  "1d": 2,
  "5d": 6,
  "1mo": 25,
  "3mo": 70,
  "6mo": 130,
  "1y": 260,
  "2y": 110,
  "5y": 260,
  max: Infinity,
};

const GROWW_SIZE: Record<string, number> = {
  "1mo": 35,
  "3mo": 90,
  "6mo": 190,
  "1y": 380,
  "2y": 130,
  "5y": 300,
  max: 480,
};

async function fetchGrowwChart(
  tradingSymbol: string,
  exchange: string,
  range: string
): Promise<Candle[] | null> {
  const resolution = GROWW_RESOLUTION[range];
  if (!resolution) return null;
  const url =
    `https://groww.in/v1/api/charting_service/v2/chart/exchange/${exchange}/segment/CASH/` +
    `${encodeURIComponent(tradingSymbol)}/${resolution}` +
    `?endTimeInMillis=${Date.now()}&size=${GROWW_SIZE[range] ?? 300}`;
  try {
    const data = await curlJson(url, ["-H", "x-app-id: growwWeb"]);
    const candles = data["candles"];
    if (!Array.isArray(candles)) return null;
    const window = GROWW_WINDOW[range] ?? Infinity;
    const parsed = candles
      .map((c) => {
        const row = Array.isArray(c) ? c : [];
        const out: Candle = {
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5] ?? 0),
        };
        return out;
      })
      .filter((c) =>
        [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v))
      );
    return window === Infinity ? parsed : parsed.slice(-window);
  } catch {
    return null;
  }
}

/* ---------- Moneycontrol (fallback 2, equities, daily/weekly/monthly) ---------- */

const MC_SPEC: Record<string, { res: string; cb: number; days: number; label: string } | null> = {
  "1d": null,
  "5d": null,
  "1mo": { res: "1D", cb: 25, days: 35, label: "1d" },
  "3mo": { res: "1D", cb: 70, days: 100, label: "1d" },
  "6mo": { res: "1D", cb: 130, days: 190, label: "1d" },
  "1y": { res: "1D", cb: 260, days: 380, label: "1d" },
  "2y": { res: "1W", cb: 110, days: 760, label: "1wk" },
  "5y": { res: "1W", cb: 260, days: 1900, label: "1wk" },
  max: { res: "1M", cb: 300, days: 9500, label: "1mo" },
};

async function fetchMoneycontrolChart(
  tradingSymbol: string,
  range: string
): Promise<{ candles: Candle[]; interval: string } | null> {
  const spec = MC_SPEC[range];
  if (!spec) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - spec.days * 86400;
  const url =
    `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(tradingSymbol)}&resolution=${spec.res}` +
    `&from=${from}&to=${now}&countback=${spec.cb}&currencyCode=INR`;
  try {
    const data = await curlJson(url);
    if (data["s"] !== "ok") return null;
    const t = data["t"] as number[];
    const o = data["o"] as number[];
    const h = data["h"] as number[];
    const l = data["l"] as number[];
    const c = data["c"] as number[];
    const v = (data["v"] as number[]) ?? [];
    if (!Array.isArray(t) || !Array.isArray(c) || !t.length) return null;
    const candles: Candle[] = t
      .map((time, i) => ({
        time,
        open: Number(o?.[i]),
        high: Number(h?.[i]),
        low: Number(l?.[i]),
        close: Number(c?.[i]),
        volume: Number(v?.[i] ?? 0),
      }))
      .filter((x) =>
        [x.open, x.high, x.low, x.close].every((n) => Number.isFinite(n))
      );
    return candles.length ? { candles, interval: spec.label } : null;
  } catch {
    return null;
  }
}

/* ---------- cache ---------- */

interface Cached {
  data: unknown;
  expires: number;
}

const cache = new Map<string, Cached>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;
  cache.delete(key);
  return null;
}

function cacheSet(key: string, data: unknown, ttlMs: number) {
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/* ---------- payload ---------- */

export interface ChartPayload {
  symbol: string;
  name: string;
  exchange: string;
  fullExchangeName: string;
  currency: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  change: number | null;
  changePct: number | null;
  range: string;
  interval: string;
  candles: Candle[];
  source: "yahoo" | "groww" | "moneycontrol";
}

export async function getChart(
  symbol: string,
  exchange: string,
  isIndex: boolean,
  range: string,
  interval: string
): Promise<ChartPayload | null> {
  const cacheKey = `${symbol}|${exchange}|${isIndex}|${range}|${interval}`;
  const hit = cacheGet<ChartPayload>(cacheKey);
  if (hit) return hit;

  const ttl = interval.endsWith("m") || interval.endsWith("h") ? 60_000 : 10 * 60_000;
  let yahooSymbol: string | null = null;

  if (symbol.includes(".")) {
    yahooSymbol = symbol;
  } else if (isIndex) {
    const code = symbol.replace(/[^A-Z0-9]/g, "_");
    const viaCaret = await fetchYahooChart(`%5E${code}`, range, interval);
    if (viaCaret) {
      const p = yahooToPayload(viaCaret, range, interval);
      if (p) {
        cacheSet(cacheKey, p, ttl);
        return p;
      }
    }
    yahooSymbol = `${code}.NS`;
  } else {
    yahooSymbol = `${symbol}.${exchange === "BSE" ? "BO" : "NS"}`;
  }

  if (yahooSymbol) {
    const y = await fetchYahooChart(yahooSymbol, range, interval);
    if (y) {
      const p = yahooToPayload(y, range, interval);
      if (p) {
        cacheSet(cacheKey, p, ttl);
        return p;
      }
    }
  }

  /* some BSE rows are NSE-listed only — retry on the other exchange */
  const crossExchange = exchange === "BSE" ? "NSE" : exchange === "NSE" ? "BSE" : null;
  if (crossExchange && !isIndex && !symbol.includes(".")) {
    const crossSymbol = `${symbol}.${crossExchange === "BSE" ? "BO" : "NS"}`;
    const y = await fetchYahooChart(crossSymbol, range, interval);
    if (y) {
      const p = yahooToPayload(y, range, interval);
      if (p) {
        cacheSet(cacheKey, p, ttl);
        return p;
      }
    }
  }

  /* fallbacks for equities: Moneycontrol (long ranges) -> Groww (short windows) */
  if (!isIndex && !symbol.includes(".")) {
    const mc = await fetchMoneycontrolChart(symbol, range);
    if (mc) {
      const inst = findInstrument(symbol);
      const closes = mc.candles.map((x) => x.close);
      const first = closes[0];
      const last = closes[closes.length - 1];
      const p: ChartPayload = {
        symbol,
        name: inst?.n ?? symbol,
        exchange,
        fullExchangeName: exchange === "NSE" ? "National Stock Exchange" : "BSE",
        currency: "INR",
        regularMarketPrice: last,
        regularMarketTime: mc.candles[mc.candles.length - 1].time,
        fiftyTwoWeekHigh: Math.max(...mc.candles.map((x) => x.high)),
        fiftyTwoWeekLow: Math.min(...mc.candles.map((x) => x.low)),
        change: last - first,
        changePct: first !== 0 ? ((last - first) / first) * 100 : null,
        range,
        interval: mc.interval,
        candles: mc.candles,
        source: "moneycontrol",
      };
      cacheSet(cacheKey, p, ttl);
      return p;
    }

    const exchanges = exchange === "NSE" ? ["NSE", "BSE"] : ["BSE", "NSE"];
    for (const ex of exchanges) {
      const candles = await fetchGrowwChart(symbol, ex, range);
      if (candles && candles.length) {
        const inst = findInstrument(symbol);
        const closes = candles.map((c) => c.close);
        const first = closes[0];
        const last = closes[closes.length - 1];
        const hi = Math.max(...candles.map((c) => c.high));
        const lo = Math.min(...candles.map((c) => c.low));
        const p: ChartPayload = {
          symbol,
          name: inst?.n ?? symbol,
          exchange: ex,
          fullExchangeName: ex === "NSE" ? "National Stock Exchange" : "BSE",
          currency: "INR",
          regularMarketPrice: last,
          regularMarketTime: candles[candles.length - 1].time,
          fiftyTwoWeekHigh: hi,
          fiftyTwoWeekLow: lo,
          change: last - first,
          changePct: ((last - first) / first) * 100,
          range,
          interval: GROWW_RESOLUTION[range] ?? interval,
          candles,
          source: "groww",
        };
        cacheSet(cacheKey, p, ttl);
        return p;
      }
    }
  }

  return null;
}

function yahooToPayload(
  result: JsonObject,
  range: string,
  interval: string
): ChartPayload | null {
  const meta = asRecord(result["meta"]) ?? {};
  const ts = Array.isArray(result["timestamp"]) ? (result["timestamp"] as number[]) : [];
  const q = asRecord(
    (asRecord(result["indicators"])?.["quote"] as unknown[])?.at(0)
  ) ?? {};

  const candles: Candle[] = ts
    .map((t, i) => ({
      time: t,
      open: asNum((q["open"] as number[])?.[i]),
      high: asNum((q["high"] as number[])?.[i]),
      low: asNum((q["low"] as number[])?.[i]),
      close: asNum((q["close"] as number[])?.[i]),
      volume: asNum((q["volume"] as number[])?.[i]) ?? 0,
    }))
    .filter(
      (c): c is Candle =>
        c.open !== null && c.high !== null && c.low !== null && c.close !== null
    );

  if (!candles.length) return null;

  const first = candles[0].close;
  const last = candles[candles.length - 1].close;
  const symbol = String(meta["symbol"] ?? "?");

  return {
    symbol,
    name: String(meta["shortName"] ?? meta["longName"] ?? symbol),
    exchange: String(meta["exchangeName"] ?? ""),
    fullExchangeName: String(meta["fullExchangeName"] ?? ""),
    currency: String(meta["currency"] ?? "INR"),
    regularMarketPrice: asNum(meta["regularMarketPrice"]) ?? last,
    regularMarketTime: asNum(meta["regularMarketTime"]) ?? candles[candles.length - 1].time,
    fiftyTwoWeekHigh: asNum(meta["fiftyTwoWeekHigh"]),
    fiftyTwoWeekLow: asNum(meta["fiftyTwoWeekLow"]),
    change: last - first,
    changePct: first !== 0 ? ((last - first) / first) * 100 : null,
    range,
    interval,
    candles,
    source: "yahoo",
  };
}

/* ---------- NIFTY 50 ticker ---------- */

const TAPE_UNIVERSE: { s: string; n: string }[] = [
  { s: "^NSEI", n: "NIFTY 50" },
  { s: "^BSESN", n: "SENSEX" },
  { s: "RELIANCE.NS", n: "RELIANCE" },
  { s: "TCS.NS", n: "TCS" },
  { s: "HDFCBANK.NS", n: "HDFC BANK" },
  { s: "ICICIBANK.NS", n: "ICICI BANK" },
  { s: "BHARTIARTL.NS", n: "BHARTI AIRTEL" },
  { s: "SBIN.NS", n: "SBI" },
  { s: "INFY.NS", n: "INFOSYS" },
  { s: "ITC.NS", n: "ITC" },
  { s: "LT.NS", n: "L&T" },
  { s: "HINDUNILVR.NS", n: "HUL" },
  { s: "AXISBANK.NS", n: "AXIS BANK" },
  { s: "BAJFINANCE.NS", n: "BAJAJ FIN" },
  { s: "KOTAKBANK.NS", n: "KOTAK BANK" },
  { s: "MARUTI.NS", n: "MARUTI" },
  { s: "M&M.NS", n: "M&M" },
  { s: "SUNPHARMA.NS", n: "SUN PHARMA" },
  { s: "TITAN.NS", n: "TITAN" },
  { s: "ULTRACEMCO.NS", n: "ULTRATECH" },
  { s: "ASIANPAINT.NS", n: "ASIAN PAINTS" },
  { s: "HCLTECH.NS", n: "HCL TECH" },
  { s: "NTPC.NS", n: "NTPC" },
  { s: "POWERGRID.NS", n: "POWER GRID" },
  { s: "TATAMOTORS.NS", n: "TATA MOTORS" },
  { s: "ADANIENT.NS", n: "ADANI ENT" },
  { s: "ADANIPORTS.NS", n: "ADANI PORTS" },
  { s: "TATASTEEL.NS", n: "TATA STEEL" },
  { s: "JSWSTEEL.NS", n: "JSW STEEL" },
  { s: "TECHM.NS", n: "TECH MAHINDRA" },
  { s: "WIPRO.NS", n: "WIPRO" },
  { s: "GRASIM.NS", n: "GRASIM" },
  { s: "COALINDIA.NS", n: "COAL INDIA" },
  { s: "ONGC.NS", n: "ONGC" },
  { s: "BPCL.NS", n: "BPCL" },
  { s: "HINDALCO.NS", n: "HINDALCO" },
  { s: "DRREDDY.NS", n: "DR REDDY" },
  { s: "CIPLA.NS", n: "CIPLA" },
  { s: "NESTLEIND.NS", n: "NESTLE IND" },
  { s: "BAJAJFINSV.NS", n: "BAJAJ FINSERV" },
  { s: "EICHERMOT.NS", n: "EICHER" },
  { s: "HEROMOTOCO.NS", n: "HERO MOTO" },
  { s: "TRENT.NS", n: "TRENT" },
  { s: "BEL.NS", n: "BEL" },
  { s: "TATACONSUM.NS", n: "TATA CONS" },
  { s: "HDFCLIFE.NS", n: "HDFC LIFE" },
  { s: "SBILIFE.NS", n: "SBI LIFE" },
  { s: "INDUSINDBK.NS", n: "INDUSIND BK" },
];

export async function getTicker(): Promise<TickerItem[]> {
  const key = "ticker";
  const hit = cacheGet<TickerItem[]>(key);
  if (hit) return hit;

  const items: TickerItem[] = [];

  /* spark endpoint is more lenient than quote under rate limits */
  const chunk = (arr: typeof TAPE_UNIVERSE, size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  for (const group of chunk(TAPE_UNIVERSE, 24)) {
    const symbols = group.map((t) => t.s).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
      symbols
    )}&range=1d&interval=5m`;
    const data = await yahooGet(url);
    const results = (data?.["spark"] as JsonObject | null)?.["result"];
    if (!Array.isArray(results)) continue;
    for (const entry of results) {
      const response = (asRecord(entry)?.["response"] as unknown[])?.at(0);
      const meta = asRecord(response)?.["meta"];
      const rec = asRecord(meta);
      if (!rec) continue;
      const sym = String(rec["symbol"] ?? "");
      const tapeEntry = TAPE_UNIVERSE.find((t) => t.s === sym);
      if (!tapeEntry) continue;
      const price = asNum(rec["regularMarketPrice"]);
      const prevClose = asNum(rec["previousClose"]);
      items.push({
        symbol: tapeEntry.n,
        name: tapeEntry.n,
        price,
        changePct:
          price !== null && prevClose != null && prevClose !== 0
            ? ((price - prevClose) / prevClose) * 100
            : null,
      });
    }
  }

  if (items.length) cacheSet(key, items, 90_000);
  return items;
}
