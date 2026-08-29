/* First-party analytics (TASK-1388): search → chart → pricing funnel.
 *
 * No third-party scripts, no cookies, no device ids, no PII. Events carry
 * only {kind, symbol?, at} and live in a localStorage queue that is flushed
 * best-effort to POST /api/analytics (same origin). Everything here is
 * fire-and-forget: every entry point swallows its own errors, so a broken
 * localStorage or a dead endpoint can never affect the terminal.
 *
 * Privacy posture (matches /privacy): symbols are tickers, not people; the
 * server aggregates counts by kind only. An opt-out flag
 * (localStorage `nifty.analytics.optout` = "1") disables capture entirely.
 * NODE_ENV=test disables capture so test runners never emit events.
 */

export type AnalyticsEventKind =
  | "search_select"
  | "chart_pick"
  | "pricing_view"
  | "page_view";

export interface AnalyticsEvent {
  kind: AnalyticsEventKind;
  /** Uppercased, charset-squeezed ticker/indices symbol — never freeform. */
  symbol?: string;
  at: number;
}

export const ANALYTICS_QUEUE_KEY = "nifty.analytics.v1";
export const ANALYTICS_OPT_OUT_KEY = "nifty.analytics.optout";
export const ANALYTICS_MAX_QUEUE = 200;
export const ANALYTICS_FLUSH_THRESHOLD = 5;
export const ANALYTICS_FLUSH_DEBOUNCE_MS = 2000;
export const ANALYTICS_ENDPOINT = "/api/analytics";

/** Kinds accepted by both client and server (route validates against this). */
export const ANALYTICS_KINDS: ReadonlySet<AnalyticsEventKind> = new Set([
  "search_select",
  "chart_pick",
  "pricing_view",
  "page_view",
]);

/* Symbols: letters, digits, space, dot, caret, equals, hyphen — enough for
   every NSE/BSE ticker and Yahoo index (^NSEI, ^BSESN) plus index names
   like "NIFTY 50". Everything else is stripped, so HTML/JS can never ride
   along. */
const SYMBOL_ALLOWED = /[^A-Z0-9 .^=-]/g;
const SYMBOL_MAX_LEN = 24;

export function sanitizeSymbol(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.toUpperCase().replace(SYMBOL_ALLOWED, "").trim();
  if (!s) return undefined;
  return s.slice(0, SYMBOL_MAX_LEN);
}

export function isAnalyticsEnabled(): boolean {
  try {
    /* test runners (node:test) must never emit events — npm test runs
       without NODE_ENV, so suites set it explicitly to exercise this */
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
      return false;
    }
    if (typeof window === "undefined" || typeof localStorage === "undefined") {
      return false; /* SSR / non-browser contexts are silent */
    }
    return localStorage.getItem(ANALYTICS_OPT_OUT_KEY) !== "1";
  } catch {
    return false;
  }
}

let queue: AnalyticsEvent[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideBound = false;

function readQueue(): AnalyticsEvent[] {
  if (queue) return queue;
  try {
    const raw = localStorage.getItem(ANALYTICS_QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      queue = parsed.filter(isValidEvent).slice(-ANALYTICS_MAX_QUEUE);
      return queue;
    }
  } catch {
    /* corrupt or unavailable — start fresh */
  }
  queue = [];
  return queue;
}

function isValidEvent(v: unknown): v is AnalyticsEvent {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.kind === "string" &&
    ANALYTICS_KINDS.has(o.kind as AnalyticsEventKind) &&
    typeof o.at === "number" &&
    Number.isFinite(o.at) &&
    (o.symbol === undefined || typeof o.symbol === "string")
  );
}

function persist(): void {
  try {
    localStorage.setItem(ANALYTICS_QUEUE_KEY, JSON.stringify(queue ?? []));
  } catch {
    /* quota / private mode — queue stays live in memory for this session */
  }
}

function bindPagehide(): void {
  if (pagehideBound || typeof document === "undefined") return;
  pagehideBound = true;
  document.addEventListener("pagehide", () => {
    /* keepalive fetch survives the unload; the response may not, so the
       queue is only cleared when the server actually acks — a lost ack
       just re-sends next visit (best-effort, tiny volume) */
    void flush();
  });
}

function scheduleFlush(): void {
  const q = readQueue();
  if (q.length >= ANALYTICS_FLUSH_THRESHOLD) {
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, ANALYTICS_FLUSH_DEBOUNCE_MS);
  bindPagehide();
}

/** Record a funnel event. Never throws; no-ops off-browser or when disabled. */
export function track(kind: AnalyticsEventKind, symbol?: string): void {
  if (!isAnalyticsEnabled()) return;
  try {
    const q = readQueue();
    const clean = sanitizeSymbol(symbol);
    q.push({ kind, ...(clean ? { symbol: clean } : {}), at: Date.now() });
    if (q.length > ANALYTICS_MAX_QUEUE) {
      q.splice(0, q.length - ANALYTICS_MAX_QUEUE);
    }
    persist();
    scheduleFlush();
  } catch {
    /* analytics must never throw */
  }
}

/** Send the whole queue as one batched POST. Resolves on failure instead of
 *  rejecting — the queue is kept so the next flush retries it. */
export async function flush(): Promise<void> {
  if (!isAnalyticsEnabled()) return;
  const q = readQueue();
  if (q.length === 0) return;
  const batch = q.slice();
  try {
    if (typeof fetch !== "function") return;
    const res = await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (res.ok) {
      /* drop exactly the events the server acked (front of queue — anything
         tracked mid-flight sits behind them) */
      const rest = readQueue();
      rest.splice(0, batch.length);
      persist();
    }
  } catch {
    /* network/endpoint failure — leave the queue for the next attempt */
  }
}

/** Current queue contents (copy) — test + debug seam. */
export function peekQueue(): AnalyticsEvent[] {
  return readQueue().slice();
}

/** Test seam: drop queued state and pending timers. Leaves the opt-out flag. */
export function resetAnalytics(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  queue = null;
  pagehideBound = false;
  try {
    localStorage.removeItem(ANALYTICS_QUEUE_KEY);
  } catch {
    /* nothing to clear */
  }
}