/* POST /api/analytics — first-party funnel events (TASK-1388).
 * GET  /api/analytics — debug funnel counts (24h / 7d / 30d) by kind.
 *
 * Store: data/analytics.json at repo root (same convention as board.json),
 * written atomically (tmp + rename). An in-process copy is the source of
 * truth; the file is a restart-safe snapshot — correct for the current
 * single-instance deployment, same accepted risk as boardGuards/tiers.
 *
 * Guards (modeled on boardGuards.ts): per-key sliding-window rate limit →
 * body cap → strict event validation (kind allowlist, symbol sanitized via
 * the shared lib, timestamp sanity window). No PII is ever accepted or
 * stored — events are {kind, symbol?, at} only.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { clientKeyFrom } from "@/lib/clientKey";
import { internalError } from "@/lib/serverError";
import {
  ANALYTICS_KINDS,
  sanitizeSymbol,
  type AnalyticsEvent,
  type AnalyticsEventKind,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

const STORE_FILE = path.resolve(process.cwd(), "..", "data", "analytics.json");
const STORE_CAP = 20_000;
const MAX_BATCH = 100;
const MAX_BODY_BYTES = 256_000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;

/* ---- rate limit: sliding 1-minute window per key (boardGuards pattern) */
const WINDOW_MS = 60_000;
const MAX_POSTS_PER_WINDOW = 300;
const postStamps = new Map<string, number[]>();

function postRateLimited(key: string, now = Date.now()): boolean {
  const list = (postStamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_POSTS_PER_WINDOW) {
    postStamps.set(key, list);
    return true;
  }
  list.push(now);
  postStamps.delete(key); /* refresh recency: delete+set keeps eviction true-LRU */
  postStamps.set(key, list);
  if (postStamps.size > 4000) {
    for (const [k, stamps] of postStamps) {
      if (now - stamps[stamps.length - 1] >= WINDOW_MS) postStamps.delete(k);
    }
  }
  return false;
}

/* ---- store -------------------------------------------------------------- */

interface AnalyticsStore {
  version: 1;
  events: AnalyticsEvent[];
}

let store: AnalyticsStore | null = null;
let storeLoadFailed = false;

async function loadStore(): Promise<AnalyticsStore> {
  if (store) return store;
  if (!storeLoadFailed) {
    try {
      const raw = await fs.readFile(STORE_FILE, "utf-8");
      const json = JSON.parse(raw) as { events?: unknown };
      if (Array.isArray(json.events)) {
        store = {
          version: 1,
          events: json.events
            .filter(isValidEvent)
            .slice(-STORE_CAP) as AnalyticsEvent[],
        };
        return store;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("ENOENT")) {
        /* corrupted snapshot — start fresh rather than crash the endpoint */
        console.error("[api/analytics] store unreadable, starting fresh:", msg);
      }
      storeLoadFailed = true;
    }
  }
  store = { version: 1, events: [] };
  return store;
}

async function persistStore(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, STORE_FILE);
}

/* Serialize mutations: read-modify-write across awaits would otherwise race
   two concurrent POSTs onto a stale snapshot (single process, but awaits
   interleave). Low volume, so a chain is plenty. */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = writeChain.then(fn, fn);
  writeChain = p.catch(() => {});
  return p;
}

function isValidEvent(v: unknown): v is AnalyticsEvent {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || !ANALYTICS_KINDS.has(o.kind as AnalyticsEventKind)) {
    return false;
  }
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return false;
  const now = Date.now();
  if (o.at < now - MAX_AGE_MS || o.at > now + MAX_SKEW_MS) return false;
  const symbol = sanitizeSymbol(o.symbol);
  if (symbol === undefined && o.symbol !== undefined) return false;
  return true;
}

/* ---- GET: debug funnel ------------------------------------------------ */

const WINDOWS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;

export async function GET() {
  try {
    const s = await loadStore();
    const now = Date.now();
    const counts: Record<string, { "24h": number; "7d": number; "30d": number; total: number }> = {};
    for (const kind of ANALYTICS_KINDS) counts[kind] = { "24h": 0, "7d": 0, "30d": 0, total: 0 };
    for (const e of s.events) {
      const c = counts[e.kind];
      c.total += 1;
      if (now - e.at <= WINDOWS["24h"]) c["24h"] += 1;
      if (now - e.at <= WINDOWS["7d"]) c["7d"] += 1;
      if (now - e.at <= WINDOWS["30d"]) c["30d"] += 1;
    }
    return NextResponse.json(
      {
        ok: true,
        counts,
        recent: s.events.slice(-20).map((e) => ({
          kind: e.kind,
          symbol: e.symbol ?? null,
          at: e.at,
        })),
        store: { events: s.events.length, cap: STORE_CAP },
        generatedAt: now,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e: unknown) {
    const ie = internalError("api/analytics:get", e);
    console.error(ie.log);
    return NextResponse.json(ie.body, { status: ie.status });
  }
}

/* ---- POST: batched events --------------------------------------------- */

export async function POST(req: Request) {
  const key = clientKeyFrom(req.headers);
  if (postRateLimited(key)) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const candidate =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { events?: unknown }).events
      : null;
  if (!Array.isArray(candidate)) {
    return NextResponse.json({ error: "invalid_events" }, { status: 400 });
  }
  const events = candidate
    .slice(0, MAX_BATCH)
    .map((e) => (isValidEvent(e) ? e : null))
    .filter((e): e is AnalyticsEvent => e !== null);
  if (events.length === 0) {
    return NextResponse.json({ error: "invalid_events" }, { status: 400 });
  }

  try {
    const accepted = await enqueue(async () => {
      const s = await loadStore();
      s.events.push(...events);
      if (s.events.length > STORE_CAP) {
        s.events.splice(0, s.events.length - STORE_CAP);
      }
      await persistStore();
      return events.length;
    });
    return NextResponse.json({ ok: true, accepted });
  } catch (e: unknown) {
    const ie = internalError("api/analytics:post", e);
    console.error(ie.log);
    return NextResponse.json(ie.body, { status: ie.status });
  }
}