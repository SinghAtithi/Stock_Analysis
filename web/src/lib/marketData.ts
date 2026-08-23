import { execFile } from "child_process";
import { promisify } from "util";
import { findInstrument, INDEX_MAP } from "@/lib/instruments";
import { nextBackoff } from "@/lib/backoff";
import type { Candle, TickerItem } from "@/lib/types";

const execFileAsync = promisify(execFile);
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type JsonObject = Record<string, unknown>;

/* Yahoo TLS-fingerprints Node's undici and 429s it; curl passes. execFile: no shell.
   -w appends "\n<http_code>" so callers can distinguish 429s from parse errors. */
async function curlRaw(
  url: string,
  extra: string[] = [],
  accept = "application/json, text/plain, */*"
): Promise<{ body: string; status: number }> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-sSL",
      "-m",
      "20",
      "--compressed",
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      `Accept: ${accept}`,
      ...extra,
      "-w",
      "\n%{http_code}",
      url,
    ],
    { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }
  );
  const cut = stdout.lastIndexOf("\n");
  const body = cut >= 0 ? stdout.slice(0, cut) : "";
  const status = cut >= 0 ? Number(stdout.slice(cut + 1).trim()) : 0;
  return { body, status };
}

async function curlJson(url: string, extra: string[] = []): Promise<{ data: JsonObject; status: number }> {
  const { body, status } = await curlRaw(url, extra);
  return { data: JSON.parse(body) as JsonObject, status };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ---------- Yahoo ---------- */

interface YahooHost {
  cooldownUntil: number;
  failures: number;
  inflight: number;
  queue: Array<() => void>;
}

const yahooHosts = new Map<string, YahooHost>();

function yahooHost(host: string): YahooHost {
  let st = yahooHosts.get(host);
  if (!st) {
    st = { cooldownUntil: 0, failures: 0, inflight: 0, queue: [] };
    yahooHosts.set(host, st);
  }
  return st;
}

/* at most 2 in-flight curl calls per Yahoo host */
async function yahooSlot<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const st = yahooHost(host);
  if (st.inflight >= 2) {
    await new Promise<void>((resolve) => st.queue.push(resolve));
  }
  st.inflight++;
  try {
    return await fn();
  } finally {
    st.inflight--;
    const next = st.queue.shift();
    if (next) next();
  }
}

async function yahooGet(url: string, host: string): Promise<JsonObject | null> {
  const st = yahooHost(host);
  if (Date.now() < st.cooldownUntil) return null;
  return yahooSlot(host, async () => {
    let body: string;
    let status: number;
    try {
      ({ body, status } = await curlRaw(url));
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (/429|Too Many Requests/.test(msg)) {
        st.failures++;
        const backoffMs = nextBackoff(st.failures - 1);
        st.cooldownUntil = Date.now() + backoffMs;
        console.log(`[yahoo] 429 host=${host} backoff=${Math.round(backoffMs / 1000)}s`);
      }
      return null;
    }
    if (status === 429 || /too many requests/i.test(body.slice(0, 512))) {
      st.failures++;
      const backoffMs = nextBackoff(st.failures - 1);
      st.cooldownUntil = Date.now() + backoffMs;
      console.log(`[yahoo] 429 host=${host} backoff=${Math.round(backoffMs / 1000)}s`);
      return null;
    }
    if (status >= 400) return null;
    try {
      const data = JSON.parse(body) as JsonObject;
      st.failures = 0;
      return data;
    } catch {
      return null;
    }
  });
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
    const data = await yahooGet(url, host);
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
    const { data, status } = await curlJson(url, ["-H", "x-app-id: growwWeb"]);
    if (status !== 200) return null;
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

/* Moneycontrol intraday resolutions (keyless 5m/15m/1h, ~500 bars each,
   live-verified 2026-08-17). Serves real intraday for the short ranges even
   while Yahoo throttles; 1m isn't available, so 1D degrades to 5m (honest via
   the payload interval). */
const MC_INTRADAY_SPEC: Record<
  string,
  { res: number; days: number; label: string } | null
> = {
  "1d": { res: 5, days: 2, label: "5m" },
  "5d": { res: 5, days: 8, label: "5m" },
  "1mo": { res: 15, days: 35, label: "15m" },
  "3mo": { res: 60, days: 95, label: "1h" },
  "6mo": { res: 60, days: 100, label: "1h" },
};

/* techCharts history JSON (stock + index endpoints share the shape) -> candles;
   null unless s:"ok" with usable t/c arrays and finite OHLC per bar */
export function mcHistoryCandles(data: JsonObject): Candle[] | null {
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
  return candles.length ? candles : null;
}

async function fetchMoneycontrolChart(
  tradingSymbol: string,
  range: string,
  intraday?: { res: number; days: number; label: string }
): Promise<{ candles: Candle[]; interval: string } | null> {
  const spec = intraday ?? MC_SPEC[range];
  if (!spec) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - spec.days * 86400;
  const url =
    `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history` +
    `?symbol=${encodeURIComponent(tradingSymbol)}&resolution=${spec.res}` +
    `&from=${from}&to=${now}&countback=${intraday ? 500 : (spec as { cb: number }).cb}&currencyCode=INR`;
  try {
    const { data, status } = await curlJson(url);
    if (status !== 200) return null;
    const candles = mcHistoryCandles(data);
    return candles ? { candles, interval: spec.label } : null;
  } catch {
    return null;
  }
}

/* ---------- Moneycontrol indices (fallback for index charts) ---------- */

/* MC index symbol codes, extracted from moneycontrol.com/indian-indices
   pages (the `symbol=` param of their priceapi/techCharts/intra calls),
   live-verified 2026-08-16 via the index/history endpoint:
   in;NSX (NIFTY 50), in;SEN (SENSEX), in;nbx (NIFTY BANK),
   in;cfr (NIFTY NEXT 50), in;bpo (NIFTY MIDCAP 100), mc;helcar (INDIA VIX).
   Case is per-symbol and edge-dependent (Akamai serves heterogeneous nodes —
   uppercase works on one, lowercase on another), and the endpoint burst-
   limits per IP with the same generic "Invalid request.Wrong symbol" error,
   so each entry carries both cases and a failed fetch sets a short cooldown. */
const MC_INDEX_SYMBOL: Record<string, [string, string]> = {
  "NIFTY 50": ["in;NSX", "in;nsx"],
  NIFTY: ["in;NSX", "in;nsx"],
  SENSEX: ["in;SEN", "in;sen"],
  BANKNIFTY: ["in;nbx", "in;NBX"],
  "NIFTY BANK": ["in;nbx", "in;NBX"],
  "INDIA VIX": ["mc;helcar", "mc;HELCAR"],
  "NIFTY NEXT 50": ["in;cfr", "in;CFR"],
  "NIFTY MIDCAP 100": ["in;bpo", "in;BPO"],
};

/* Same windows as MC_SPEC, but the index endpoint only serves 1D/1W and
   caps countback at 500 (1M resolution and cb>500 return s:"error"), so
   max degrades to weekly instead of monthly. */
const MC_INDEX_SPEC: Record<string, { res: string; cb: number; days: number; label: string } | null> = {
  "1d": null,
  "5d": null,
  "1mo": { res: "1D", cb: 25, days: 35, label: "1d" },
  "3mo": { res: "1D", cb: 70, days: 100, label: "1d" },
  "6mo": { res: "1D", cb: 130, days: 190, label: "1d" },
  "1y": { res: "1D", cb: 260, days: 380, label: "1d" },
  "2y": { res: "1W", cb: 110, days: 760, label: "1wk" },
  "5y": { res: "1W", cb: 260, days: 1900, label: "1wk" },
  max: { res: "1W", cb: 500, days: 3800, label: "1wk" },
};

/* per-symbol cooldown after a full failure, so burst-limited bursts don't
   compound (the endpoint answers every call, error or not) */
const mcIndexCooldown = new Map<string, number>();

async function fetchMoneycontrolIndexChart(
  symbol: string,
  range: string
): Promise<{ candles: Candle[]; interval: string } | null> {
  const variants = MC_INDEX_SYMBOL[symbol];
  const spec = MC_INDEX_SPEC[range];
  if (!variants || !spec) return null;
  const key = `${symbol}|${range}`;
  if (Date.now() < (mcIndexCooldown.get(key) ?? 0)) return null;
  const now = Math.floor(Date.now() / 1000);
  const from = now - spec.days * 86400;
  const parse = (data: JsonObject): { candles: Candle[]; interval: string } | null => {
    const candles = mcHistoryCandles(data);
    return candles ? { candles, interval: spec.label } : null;
  };
  try {
    for (const mcSymbol of variants) {
      const url =
        `https://priceapi.moneycontrol.com/techCharts/indianMarket/index/history` +
        `?symbol=${mcSymbol}&resolution=${spec.res}` +
        `&from=${from}&to=${now}&countback=${spec.cb}&currencyCode=INR`;
      const { data, status } = await curlJson(url);
      if (status === 200) {
        const out = parse(data);
        if (out) return out;
      }
    }
    mcIndexCooldown.set(key, Date.now() + 30_000);
    return null;
  } catch {
    mcIndexCooldown.set(key, Date.now() + 30_000);
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
  return null;
}

/* expired-but-recent entries survive for stale-while-revalidate */
function cacheGetStale<T>(key: string, withinMs: number): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.expires < withinMs) return hit.data as T;
  return null;
}

function cacheSet(key: string, data: unknown, ttlMs: number) {
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

/* ---------- day-change / 52W helpers ---------- */

function istDay(tsSec: number): number {
  const d = new Date((tsSec + 5.5 * 3600) * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* close of the last candle whose calendar day (IST) is strictly before the
   last candle's day; null if undeterminable */
export function previousCloseFromCandles(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const lastDay = istDay(candles[candles.length - 1].time);
  for (let i = candles.length - 2; i >= 0; i--) {
    if (istDay(candles[i].time) < lastDay) return candles[i].close;
  }
  return null;
}

export function distinctTradingDays(candles: Candle[]): number {
  const days = new Set<number>();
  for (const c of candles) days.add(istDay(c.time));
  return days.size;
}

export function dayChange(
  price: number | null,
  prevClose: number | null
): { change: number | null; changePct: number | null } {
  if (price === null || prevClose === null || prevClose === 0) {
    return { change: null, changePct: null };
  }
  const change = price - prevClose;
  return { change, changePct: (change / prevClose) * 100 };
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
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  change: number | null;
  changePct: number | null;
  range: string;
  interval: string;
  candles: Candle[];
  source: "yahoo" | "groww" | "moneycontrol" | "google";
  stale?: boolean;
  degraded?: string;
}

/* ---------- shared fallback payload builder (TASK-05) ---------- */

interface FallbackBase {
  symbol: string;
  exchange: string;
  range: string;
}

/* One construction path for every non-Yahoo source. allow52W=false (intraday)
 * forces 52W nulls; otherwise the >=250 distinct IST trading days rule applies. */
function fallbackPayload(
  base: FallbackBase,
  src: {
    source: "moneycontrol" | "groww";
    candles: Candle[];
    interval: string;
    allow52W: boolean;
    filterFuture?: boolean;
    degraded?: string;
  }
): ChartPayload | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const candles = src.filterFuture
    ? src.candles.filter((c) => c.time <= nowSec)
    : src.candles;
  if (!candles.length) return null;

  const inst = findInstrument(base.symbol);
  const lastCandle = candles[candles.length - 1];
  const prevClose = previousCloseFromCandles(candles);
  const { change, changePct } = dayChange(lastCandle.close, prevClose);
  const hasYear = src.allow52W && distinctTradingDays(candles) >= 250;

  const p: ChartPayload = {
    symbol: base.symbol,
    name: inst?.n ?? base.symbol,
    exchange: base.exchange,
    fullExchangeName: base.exchange === "NSE" ? "National Stock Exchange" : "BSE",
    currency: "INR",
    regularMarketPrice: lastCandle.close,
    regularMarketTime: lastCandle.time,
    previousClose: prevClose,
    fiftyTwoWeekHigh: hasYear ? Math.max(...candles.map((x) => x.high)) : null,
    fiftyTwoWeekLow: hasYear ? Math.min(...candles.map((x) => x.low)) : null,
    change,
    changePct,
    range: base.range,
    interval: src.interval,
    candles,
    source: src.source,
  };
  if (src.degraded) p.degraded = src.degraded;
  return p;
}

/* ---------- getChart: singleflight + budgeted fallback chain (TASK-05) ---------- */

// whole-chain upstream budget per request; exhaustion falls through to
// stale-while-revalidate / fail-fast instead of stacking more fallbacks
const UPSTREAM_BUDGET_MS = 12_000;

// concurrent identical requests coalesce onto one in-flight chain
const inflights = new Map<string, Promise<ChartPayload | null>>();

async function withinBudget<T>(p: Promise<T>, deadline: number): Promise<T | null> {
  const left = deadline - Date.now();
  if (left <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), left);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
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

  const inflight = inflights.get(cacheKey);
  if (inflight) return inflight;

  const task = chartChain(symbol, exchange, isIndex, range, interval, cacheKey);
  inflights.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflights.delete(cacheKey);
  }
}

const CHAIN_STOP = Symbol("chart-chain-stop");
type Attempt = () => Promise<ChartPayload | null | typeof CHAIN_STOP>;

async function chartChain(
  symbol: string,
  exchange: string,
  isIndex: boolean,
  range: string,
  interval: string,
  cacheKey: string
): Promise<ChartPayload | null> {
  const ttl = interval.endsWith("m") || interval.endsWith("h") ? 60_000 : 10 * 60_000;
  const deadline = Date.now() + UPSTREAM_BUDGET_MS;
  const dot = symbol.includes(".");
  const base: FallbackBase = { symbol, exchange, range };
  const put = (p: ChartPayload) => {
    cacheSet(cacheKey, p, ttl);
    return p;
  };

  const tryYahoo = async (sym: string): Promise<ChartPayload | null> => {
    const y = await withinBudget(fetchYahooChart(sym, range, interval), deadline);
    return y ? yahooToPayload(y, range, interval) : null;
  };

  const attempts: Attempt[] = [];
  if (dot) {
    attempts.push(() => tryYahoo(symbol));
  } else if (isIndex) {
    const caret = INDEX_MAP[symbol] ?? `^${symbol.replace(/[^A-Z0-9]/g, "_")}`;
    attempts.push(() => tryYahoo(caret));
    attempts.push(() => tryYahoo(`${symbol.replace(/[^A-Z0-9]/g, "_")}.NS`));
  } else {
    attempts.push(() => tryYahoo(`${symbol}.${exchange === "BSE" ? "BO" : "NS"}`));
    const crossSuffix = exchange === "BSE" ? "NS" : "BO"; // some BSE rows are NSE-listed only
    attempts.push(() => tryYahoo(`${symbol}.${crossSuffix}`));
  }

  /* Moneycontrol intraday (equities): keyless 5m/15m/1h - richer than Google's
     74-bar 1D series, so it comes first. Bars seeded for the upcoming session
     are dropped; if nothing survives, fail fast (original behaviour). */
  if (!isIndex && !dot && MC_INTRADAY_SPEC[range]) {
    const spec = MC_INTRADAY_SPEC[range];
    attempts.push(async () => {
      const mc = await withinBudget(fetchMoneycontrolChart(symbol, range, spec), deadline);
      if (!mc) return null;
      const p = fallbackPayload(base, {
        source: "moneycontrol",
        candles: mc.candles,
        interval: mc.interval,
        allow52W: false,
        filterFuture: true,
      });
      return p ?? CHAIN_STOP;
    });
  }

  /* Google Finance intraday (1d/5d): NSE equities + indices */
  if ((range === "1d" || range === "5d") && !dot) {
    attempts.push(async () => {
      const g = await withinBudget(fetchGoogleChart(symbol, exchange, isIndex), deadline);
      return g ? googleToPayload(g, symbol, exchange, isIndex, range, interval) : null;
    });
  }

  /* Moneycontrol index chart (any range): the only non-Google index fallback */
  if (isIndex && !dot) {
    attempts.push(async () => {
      const mc = await withinBudget(fetchMoneycontrolIndexChart(symbol, range), deadline);
      return mc
        ? fallbackPayload(base, {
            source: "moneycontrol",
            candles: mc.candles,
            interval: mc.interval,
            allow52W: true,
          })
        : null;
    });
  }

  /* equity long ranges: Moneycontrol daily, then Groww (both exchanges;
     short windows come back daily-only -> degraded chip) */
  if (!isIndex && !dot) {
    attempts.push(async () => {
      const mc = await withinBudget(fetchMoneycontrolChart(symbol, range), deadline);
      return mc
        ? fallbackPayload(base, {
            source: "moneycontrol",
            candles: mc.candles,
            interval: mc.interval,
            allow52W: true,
          })
        : null;
    });

    const exchanges = exchange === "NSE" ? ["NSE", "BSE"] : ["BSE", "NSE"];
    for (const ex of exchanges) {
      attempts.push(async () => {
        const candles = await withinBudget(fetchGrowwChart(symbol, ex, range), deadline);
        if (!candles || !candles.length) return null;
        return fallbackPayload(
          { ...base, exchange: ex },
          {
            source: "groww",
            candles,
            interval: GROWW_RESOLUTION[range] ?? interval,
            allow52W: true,
            degraded: range === "1d" || range === "5d" ? "daily" : undefined,
          }
        );
      });
    }
  }

  for (const attempt of attempts) {
    if (Date.now() > deadline) break; // budget spent -> stale / fail-fast
    const res = await withinBudget(attempt(), deadline);
    if (res === CHAIN_STOP) return null;
    if (res) return put(res);
  }

  /* stale-while-revalidate: serve a recently-expired entry instead of failing */
  const stale = cacheGetStale<ChartPayload>(cacheKey, 6 * 60 * 60_000);
  if (stale) return { ...stale, stale: true };

  return null;
}

export function yahooToPayload(
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

  const last = candles[candles.length - 1].close;
  const symbol = String(meta["symbol"] ?? "?");
  const metaPrice = asNum(meta["regularMarketPrice"]);
  const prevClose = asNum(meta["previousClose"]);
  const { change, changePct } = dayChange(metaPrice, prevClose);

  return {
    symbol,
    name: String(meta["shortName"] ?? meta["longName"] ?? symbol),
    exchange: String(meta["exchangeName"] ?? ""),
    fullExchangeName: String(meta["fullExchangeName"] ?? ""),
    currency: String(meta["currency"] ?? "INR"),
    regularMarketPrice: metaPrice ?? last,
    regularMarketTime: asNum(meta["regularMarketTime"]) ?? candles[candles.length - 1].time,
    previousClose: prevClose,
    fiftyTwoWeekHigh: asNum(meta["fiftyTwoWeekHigh"]),
    fiftyTwoWeekLow: asNum(meta["fiftyTwoWeekLow"]),
    change,
    changePct,
    range,
    interval,
    candles,
    source: "yahoo",
  };
}

/* ---------- Google Finance (intraday fallback: NSE equities + indices) ---------- */

interface GoogleSeries {
  candles: Candle[];
  intervalSec: number | null;
}

interface GoogleQuote {
  name: string | null;
  prevClose: number | null;
}

const GOOGLE_INDEX: Record<string, string> = {
  NIFTY: "NIFTY_50:INDEXNSE",
  BANKNIFTY: "NIFTY_BANK:INDEXNSE",
  SENSEX: "SENSEX:INDEXBOM",
  NIFTYNXT50: "NIFTY_NEXT_50:INDEXNSE",
  FINNIFTY: "NIFTY_FIN_SERVICE:INDEXNSE",
};

function googleFinanceSymbol(
  symbol: string,
  exchange: string,
  isIndex: boolean
): string | null {
  if (isIndex) {
    const mapped = GOOGLE_INDEX[symbol];
    if (mapped) return mapped;
    const code = symbol.replace(/ /g, "_");
    return exchange === "BSE" ? `${code}:INDEXBOM` : `${code}:INDEXNSE`;
  }
  if (exchange === "BSE") return null; /* Google Finance dropped BSE equities */
  return `${symbol}:NSE`;
}

function googlePairMatches(rec0: unknown, ticker: string, exch: string): boolean {
  if (!Array.isArray(rec0)) return false;
  if (rec0.length === 2 && rec0[0] === ticker && rec0[1] === exch) return true;
  for (const part of [rec0[0], rec0[1]]) {
    if (Array.isArray(part) && part[0] === ticker && part[1] === exch) return true;
  }
  return false;
}

export function parseGoogleFinance(
  html: string,
  ticker: string,
  exch: string
): { quote: GoogleQuote; series: GoogleSeries[] } | null {
  const quote: GoogleQuote = { name: null, prevClose: null };
  const series: GoogleSeries[] = [];

  const blocks = html.matchAll(
    /AF_initDataCallback\((\{key: 'ds:\d+'[\s\S]*?\})\);(?:, ?(?:true|false))?(?=<\/script>)/g
  );

  for (const block of blocks) {
    const dm = /data:([\s\S]*?), sideChannel/.exec(block[1]);
    if (!dm) continue;
    let data: unknown;
    try {
      data = JSON.parse(dm[1]);
    } catch {
      continue;
    }
    if (!Array.isArray(data) || !Array.isArray(data[0])) continue;
    for (const rec of data[0] as unknown[]) {
      if (!Array.isArray(rec)) continue;
      if (!googlePairMatches(rec[0], ticker, exch)) continue;
      if (Array.isArray(rec[3])) {
        /* series record: prevClose/name/intervalSec at fixed offsets */
        const prevClose = asNum(rec[6]);
        if (prevClose !== null) quote.prevClose = prevClose;
        if (typeof rec[7] === "string" && rec[7]) quote.name = rec[7];
        const intervalSec = asNum(rec[8]);
        for (const s of rec[3] as unknown[]) {
          if (!Array.isArray(s)) continue;
          const rows = s[s.length - 1];
          if (!Array.isArray(rows) || !rows.length || !Array.isArray(rows[0])) continue;
          if (typeof rows[0][4] !== "string" || !String(rows[0][4]).includes("T")) continue;
          const candles: Candle[] = [];
          for (const r of rows as unknown[]) {
            if (!Array.isArray(r)) continue;
            const iso = r[4];
            if (typeof iso !== "string" || !iso.includes("T")) continue;
            const o = asNum(r[0]);
            const c = asNum(r[1]);
            const h = asNum(r[2]);
            const l = asNum(r[3]);
            if (o === null || c === null || h === null || l === null) continue;
            const t = Math.floor(Date.parse(iso) / 1000);
            if (!Number.isFinite(t)) continue;
            candles.push({
              time: t,
              open: o,
              high: h,
              low: l,
              close: c,
              volume: asNum(r[5]) ?? 0,
            });
          }
          if (candles.length) series.push({ candles, intervalSec });
        }
      } else if (quote.prevClose === null) {
        /* quote record: prevClose derivable from change / changePct (layout varies) */
        const change = asNum(rec[9]);
        const changePct = asNum(rec[11]);
        if (change !== null && changePct !== null && changePct !== 0) {
          const derived = change / (changePct / 100);
          if (Number.isFinite(derived) && derived > 0) quote.prevClose = derived;
        }
      }
    }
  }

  if (!series.length) return null;
  return { quote, series };
}

async function fetchGoogleChart(
  symbol: string,
  exchange: string,
  isIndex: boolean
): Promise<{ quote: GoogleQuote; series: GoogleSeries[] } | null> {
  const gf = googleFinanceSymbol(symbol, exchange, isIndex);
  if (!gf) return null;
  const url = `https://www.google.com/finance/quote/${encodeURIComponent(gf)}?hl=en`;
  try {
    const { body, status } = await curlRaw(
      url,
      [],
      "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
    );
    if (status !== 200) return null;
    const [ticker, exch] = gf.split(":");
    return parseGoogleFinance(body, ticker, exch);
  } catch {
    return null;
  }
}

export function googleToPayload(
  parsed: { quote: GoogleQuote; series: GoogleSeries[] },
  symbol: string,
  exchange: string,
  isIndex: boolean,
  range: string,
  interval: string
): ChartPayload | null {
  let candles: Candle[] = [];
  let outInterval = interval;
  let degraded: string | undefined;

  const daily = parsed.series
    .filter((s) => s.intervalSec === null || s.intervalSec >= 3600)
    .sort((a, b) => b.candles.length - a.candles.length);

  if (range === "1d") {
    const intraday = parsed.series
      .filter((s) => s.intervalSec !== null && s.intervalSec > 60 && s.intervalSec < 3600)
      .sort((a, b) => b.candles.length - a.candles.length);
    const fiveMin = intraday.find((s) => s.intervalSec === 300);
    const pick = fiveMin ?? intraday[0];
    if (pick) {
      candles = pick.candles;
      outInterval =
        pick.intervalSec === 60 ? "1m" : pick.intervalSec === 900 ? "15m" : "5m";
    } else if (daily.length) {
      candles = daily[0].candles.slice(-2);
      outInterval = "1d";
      degraded = "daily";
    }
  } else {
    /* 5d: no multi-day intraday on the quote page — degrade to daily */
    const fifteen = parsed.series.find((s) => s.intervalSec === 900);
    if (fifteen) {
      candles = fifteen.candles;
      outInterval = "15m";
    } else if (daily.length) {
      candles = daily[0].candles.slice(-6);
      outInterval = "1d";
      degraded = "daily";
    }
  }

  if (!candles.length) return null;

  const last = candles[candles.length - 1].close;
  const prevClose = parsed.quote.prevClose ?? previousCloseFromCandles(candles);
  const price = last;
  const { change, changePct } = dayChange(price, prevClose);
  const inst = findInstrument(symbol);

  return {
    symbol,
    name: parsed.quote.name ?? inst?.n ?? symbol,
    exchange,
    fullExchangeName: isIndex
      ? exchange === "BSE"
        ? "BSE"
        : "National Stock Exchange"
      : exchange === "NSE"
        ? "National Stock Exchange"
        : "BSE",
    currency: "INR",
    regularMarketPrice: price,
    regularMarketTime: candles[candles.length - 1].time,
    previousClose: prevClose,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    change,
    changePct,
    range,
    interval: outInterval,
    candles,
    source: "google",
    ...(degraded ? { degraded } : {}),
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

  /* spark endpoint caps at 20 symbols per request (verified: 21+ → 400) */
  for (const group of chunk(TAPE_UNIVERSE, 20)) {
    const symbols = group.map((t) => t.s).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
      symbols
    )}&range=1d&interval=5m`;
    const data = await yahooGet(url, "query1");
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
      const sourceSym = tapeEntry.s;
      const isIndex = sourceSym.startsWith("^");
      items.push({
        symbol: tapeEntry.n,
        name: tapeEntry.n,
        price,
        changePct:
          price !== null && prevClose != null && prevClose !== 0
            ? ((price - prevClose) / prevClose) * 100
            : null,
        exchange: isIndex || sourceSym.endsWith(".NS") ? "NSE" : "BSE",
        type: isIndex ? "Index" : "Equity",
      });
    }
  }

  if (items.length) cacheSet(key, items, 90_000);
  /* stale-while-revalidate: last good tape survives up to 30min past expiry */
  if (!items.length) {
    const stale = cacheGetStale<TickerItem[]>(key, 30 * 60_000);
    if (stale && stale.length) return stale;
  }
  return items;
}
