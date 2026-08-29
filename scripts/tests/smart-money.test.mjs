import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openDb } from "../lib/db.mjs";
import { applyMigrations } from "../migrate.mjs";
import {
  dealRowToItem,
  announcementToItem,
  classifyAnnouncement,
  itemId,
  ingestItems,
  recordStatus,
  runIngest,
} from "../ingest-smart-money.mjs";
import {
  STRATEGY_BY_KIND,
  shapeItem,
  groupBySymbol,
  dealAlertPayload,
} from "../../web/src/lib/smartMoney.ts";
import { validateAlertInput } from "../../web/src/lib/alerts.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures", "smart-money");

const fixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

function tempDb(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-smart-money-"));
  const db = openDb(path.join(dir, "test.db"));
  applyMigrations(db);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return db;
}

function tempDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "niftyterm-smart-money-cache-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/* ---------- parser: bulk/block deals (AC1/AC2) ---------- */

test("deal parser flattens bulk-deal fixture rows (qty, price, value, date)", () => {
  const raw = fixture("bulk_deals.json");
  const items = raw.data.map((r) => dealRowToItem(r, "bulk_deal")).filter(Boolean);
  assert.ok(items.length >= 1, "fixture has rows");
  const aspire = items.find((i) => i.symbol === "ASPIRE");
  assert.ok(aspire);
  assert.equal(aspire.kind, "bulk_deal");
  assert.equal(aspire.client, "ARUNA AGARWAL");
  assert.equal(aspire.buySell, "SELL");
  assert.equal(aspire.qty, 108000);
  assert.equal(aspire.price, 13.55);
  assert.equal(aspire.value, 108000 * 13.55);
  assert.equal(aspire.tradeDate, "2026-08-25");
  assert.equal(aspire.source, "nse-bulk");
});

test("deal parser maps block-deal rows to block_deal kind + nse-block source", () => {
  const raw = fixture("block_deals.json");
  const items = raw.data.map((r) => dealRowToItem(r, "block_deal")).filter(Boolean);
  assert.ok(items.length >= 1);
  const pwl = items.find((i) => i.symbol === "PWL");
  assert.ok(pwl);
  assert.equal(pwl.kind, "block_deal");
  assert.equal(pwl.source, "nse-block");
  assert.equal(pwl.buySell, "BUY");
  assert.equal(pwl.qty, 2352677);
  assert.equal(pwl.price, 117.72);
});

test("deal parser rejects malformed rows (missing qty/symbol/date)", () => {
  assert.equal(dealRowToItem({ BD_QTY_TRD: 0, BD_SYMBOL: "X" }, "bulk_deal"), null);
  assert.equal(dealRowToItem({ BD_QTY_TRD: 100, BD_SYMBOL: "" }, "bulk_deal"), null);
  assert.equal(dealRowToItem({ BD_QTY_TRD: 100, BD_SYMBOL: "X", BD_DT_DATE: "nope" }, "bulk_deal"), null);
  assert.equal(dealRowToItem(null, "bulk_deal"), null);
});

/* ---------- parser: announcements -> insider / pledge (AC1) ---------- */

test("announcement classifier splits SAST/insider and pledge filings", () => {
  assert.equal(classifyAnnouncement({ desc: "Disclosure under SEBI (SAST) Regulations" }), "insider");
  assert.equal(classifyAnnouncement({ attchmntText: "Intimation of insider trading disclosure received" }), "insider");
  assert.equal(classifyAnnouncement({ desc: "Intimation regarding pledge of shares by promoter" }), "pledge");
  assert.equal(classifyAnnouncement({ desc: "Release of shares pledged with lender" }), "pledge");
  assert.equal(classifyAnnouncement({ desc: "Outcome of Board Meeting" }), null);
  assert.equal(classifyAnnouncement({ desc: "Copy of Newspaper Publication" }), null);
  /* trading-window boilerplate quotes the insider-trading regulation but
     reports no insider activity — must NOT classify as an insider trade */
  assert.equal(
    classifyAnnouncement({
      attchmntText:
        "has informed the Exchange regarding the Trading Window closure pursuant to SEBI (Prohibition of Insider Trading) Regulations, 2015",
    }),
    null
  );
});

test("announcement parser yields insider/pledge items with symbol + date", () => {
  const item = announcementToItem({
    symbol: "TCS",
    sm_name: "Tata Consultancy Services Limited",
    desc: "Disclosure under SEBI (SAST) Regulations",
    sort_date: "2026-08-28 18:30:00",
    seq_id: "999",
  });
  assert.ok(item);
  assert.equal(item.kind, "insider");
  assert.equal(item.symbol, "TCS");
  assert.equal(item.tradeDate, "2026-08-28");
  assert.equal(item.source, "nse-announcements");
  assert.equal(item.qty, null);
  assert.equal(item.price, null);
});

test("announcement parser drops non-smart-money announcements (real fixture, no false positives)", () => {
  const raw = fixture("announcements.json");
  const items = raw.map(announcementToItem).filter(Boolean);
  assert.deepEqual(items, [], "no SAST/pledge items in the fixture batch — healthy empty");
});

/* ---------- natural key idempotency (AC1) ---------- */

test("item id is stable across identical re-ingests", () => {
  const a = dealRowToItem(fixture("bulk_deals.json").data[0], "bulk_deal");
  const b = dealRowToItem(fixture("bulk_deals.json").data[0], "bulk_deal");
  assert.ok(a && b);
  assert.equal(itemId(a), itemId(b));
});

test("ingest is idempotent: upsert twice leaves one row", (t) => {
  const db = tempDb(t);
  const item = dealRowToItem(fixture("bulk_deals.json").data[0], "bulk_deal");
  assert.ok(item);
  ingestItems(db, [item]);
  ingestItems(db, [item]);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM smart_money_feed").get();
  assert.equal(rows.n, 1);
});

/* ---------- jury mapping (AC3) ---------- */

test("kind -> strategy mapping matches RANKINGS.md jury table", () => {
  const expect = {
    bulk_deal: { strategyId: "S113", strategyRank: 46 },
    block_deal: { strategyId: "S113", strategyRank: 46 },
    insider: { strategyId: "S107", strategyRank: 18 },
    pledge: { strategyId: "S122", strategyRank: 25 },
  };
  for (const [kind, want] of Object.entries(expect)) {
    const tag = STRATEGY_BY_KIND[kind];
    assert.equal(tag.strategyId, want.strategyId, kind);
    assert.equal(tag.strategyRank, want.strategyRank, kind);
  }
  assert.equal(STRATEGY_BY_KIND.bulk_deal.tag, "S113 · bulk");
  assert.equal(STRATEGY_BY_KIND.block_deal.tag, "S113 · block");
  assert.equal(STRATEGY_BY_KIND.insider.tag, "S107 · insider");
  assert.equal(STRATEGY_BY_KIND.pledge.tag, "S122 · pledge");
});

test("shapeItem attaches the strategy tag and rejects unknown kinds", () => {
  const shaped = shapeItem({
    id: "x",
    kind: "block_deal",
    symbol: "PWL",
    security_name: "Physicswallah Limited",
    client: "CITIGROUP",
    buy_sell: "BUY",
    qty: 2352677,
    price: 117.72,
    value: 2352677 * 117.72,
    trade_date: "2026-08-26",
    source: "nse-block",
    desc: null,
  });
  assert.ok(shaped);
  assert.equal(shaped.strategy.strategyId, "S113");
  assert.equal(shaped.buySell, "BUY");
  assert.equal(shapeItem({ ...shaped, kind: "crypto" }), null);
});

test("groupBySymbol groups rows per symbol, newest date first", () => {
  const mk = (id, symbol, tradeDate, kind = "bulk_deal") =>
    shapeItem({
      id,
      kind,
      symbol,
      security_name: null,
      client: null,
      buy_sell: "BUY",
      qty: 100,
      price: 10,
      value: 1000,
      trade_date: tradeDate,
      source: "nse-bulk",
      desc: null,
    });
  const groups = groupBySymbol([
    mk("a1", "AAA", "2026-08-26"),
    mk("a2", "AAA", "2026-08-25"),
    mk("b1", "BBB", "2026-08-27"),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].symbol, "BBB");
  assert.equal(groups[1].symbol, "AAA");
  assert.deepEqual(groups[1].items.map((i) => i.tradeDate), ["2026-08-26", "2026-08-25"]);
});

/* ---------- alert wiring (AC4) ---------- */

test("dealAlertPayload expresses a deal as a pipeline-supported price_above alert", () => {
  const item = shapeItem({
    id: "x",
    kind: "block_deal",
    symbol: "PWL",
    security_name: null,
    client: null,
    buy_sell: "BUY",
    qty: 2352677,
    price: 117.725,
    value: 2352677 * 117.725,
    trade_date: "2026-08-26",
    source: "nse-block",
    desc: null,
  });
  assert.ok(item);
  const payload = dealAlertPayload(item, "device-aaaaaaaa");
  assert.deepEqual(payload, {
    deviceId: "device-aaaaaaaa",
    symbol: "PWL",
    exchange: "NSE",
    type: "price_above",
    price: 117.73,
  });
});

test("dealAlertPayload payload passes the existing pipeline validator", () => {
  const item = shapeItem({
    id: "x",
    kind: "bulk_deal",
    symbol: "ASPIRE",
    security_name: null,
    client: null,
    buy_sell: "SELL",
    qty: 108000,
    price: 13.55,
    value: 108000 * 13.55,
    trade_date: "2026-08-25",
    source: "nse-bulk",
    desc: null,
  });
  assert.ok(item);
  const payload = dealAlertPayload(item, "device-aaaaaaaa");
  assert.ok(payload);
  const r = validateAlertInput(payload);
  assert.ok(r.ok, JSON.stringify(r));
});

test("dealAlertPayload is null for price-less items (SAST/pledge) — no broken alerts", () => {
  const insider = shapeItem({
    id: "y",
    kind: "insider",
    symbol: "TCS",
    security_name: null,
    client: null,
    buy_sell: null,
    qty: null,
    price: null,
    value: null,
    trade_date: "2026-08-28",
    source: "nse-announcements",
    desc: "SAST",
  });
  assert.ok(insider);
  assert.equal(dealAlertPayload(insider, "device-aaaaaaaa"), null);
});

/* ---------- ingest integration (AC1) ---------- */

test("runIngest with fixture fetchers persists rows + per-source status", async (t) => {
  const db = tempDb(t);
  const fetchers = {
    "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=bulk_deals&from=25-08-2026&to=29-08-2026":
      fixture("bulk_deals.json"),
    "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=block_deals&from=25-08-2026&to=29-08-2026":
      fixture("block_deals.json"),
    "https://www.nseindia.com/api/corporate-announcements?index=equities": fixture("announcements.json"),
  };
  const summary = await runIngest(db, {
    force: true,
    days: 5,
    cacheDir: tempDir(t),
    fetchImpl: (url) => {
      const hit = fetchers[url];
      if (!hit) throw new Error(`no fixture for ${url}`);
      return Promise.resolve(hit);
    },
    onLog: () => {},
  });
  assert.ok(summary.fetched >= 70, `persisted rows (got ${summary.fetched})`);
  const feed = db.prepare("SELECT COUNT(*) AS n FROM smart_money_feed").get();
  assert.equal(feed.n, summary.fetched);
  const statuses = db.prepare("SELECT source, ok FROM smart_money_status ORDER BY source").all();
  assert.deepEqual(
    statuses.map((s) => [s.source, s.ok]),
    [
      ["nse-announcements", 1],
      ["nse-block", 1],
      ["nse-bulk", 1],
    ]
  );
});

test("runIngest skips when fresh rows exist unless --force", async (t) => {
  const db = tempDb(t);
  const cacheDir = tempDir(t);
  const mk = (url) => () => Promise.resolve(url.includes("bulk_deals") ? fixture("bulk_deals.json") : { data: [] });
  await runIngest(db, { force: true, cacheDir, fetchImpl: mk("bulk_deals") });
  const before = db.prepare("SELECT COUNT(*) AS n FROM smart_money_feed").get().n;
  assert.ok(before > 0);
  const skipped = await runIngest(db, { cacheDir, fetchImpl: mk("bulk_deals"), onLog: () => {} });
  assert.equal(skipped.fetched, 0, "fresh window short-circuits");
  const after = db.prepare("SELECT COUNT(*) AS n FROM smart_money_feed").get().n;
  assert.equal(after, before);
});

test("blocked source records ok=0 status (AC5 empty-state contract)", async (t) => {
  const db = tempDb(t);
  const summary = await runIngest(db, {
    force: true,
    days: 5,
    cacheDir: tempDir(t),
    fetchImpl: () => {
      throw new Error("curl https://www.nseindia.com/... failed: 403 Forbidden");
    },
    onLog: () => {},
  });
  assert.equal(summary.fetched, 0);
  assert.equal(summary.blocked.length, 3);
  const statuses = db.prepare("SELECT ok, detail_json FROM smart_money_status").all();
  assert.equal(statuses.length, 3);
  for (const s of statuses) {
    assert.equal(s.ok, 0);
    assert.equal(JSON.parse(s.detail_json).blocked, true);
  }
});

test("recordStatus upserts per source", (t) => {
  const db = tempDb(t);
  recordStatus(db, { source: "nse-bulk", ok: false, blocked: true, rows: 0 });
  recordStatus(db, { source: "nse-bulk", ok: true, rows: 5 });
  const rows = db.prepare("SELECT * FROM smart_money_status").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, 1);
});