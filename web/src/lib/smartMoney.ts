/**
 * Smart-money radar (TASK-1415) — read model + jury-strategy mapping.
 *
 * The feed (scripts/ingest-smart-money.mjs → smart_money_feed) carries raw
 * event kinds: bulk_deal, block_deal, insider (SAST), pledge. Each kind maps
 * to one jury strategy from RANKINGS.md — the mapping is local to this module
 * (the strategy registry in lib/strategies is another agent's WIP).
 *
 *   bulk_deal / block_deal → S113  Block/Bulk Deal Following      (rank 46)
 *   insider (SAST filings) → S107  Buybacks & Insider Buying      (rank 18)
 *   pledge changes         → S122  Promoter Buying Follow         (rank 25)
 *
 * Honesty notes: S113 is literally "follow block/bulk deals". S107 covers
 * insider open-market purchases. S122 follows promoter buying — a pledge
 * release/pledge decrease is the promoter-side bullish analogue; a pledge
 * increase is cautionary but remains a promoter-ownership event, so it stays
 * tagged S122 with its direction visible in the row text.
 *
 * Alert wiring (AC4): the alert pipeline (/api/alerts) evaluates only price
 * crosses and strategy membership — there is no "new event" lane. A deal
 * alert is therefore expressed as the supported price_above type priced at
 * the deal's execution price: it fires when the quote confirms above the
 * deal price (the S113 follow entry). Items without a trade price (SAST /
 * pledge) cannot express a target and must not offer the button.
 */

export type SmartMoneyKind = "bulk_deal" | "block_deal" | "insider" | "pledge";

export interface SmartMoneyStrategyTag {
  strategyId: string;
  strategyName: string;
  strategyRank: number;
  /** compact chip label, e.g. "S113 · bulk" */
  tag: string;
}

export const STRATEGY_BY_KIND: Record<SmartMoneyKind, SmartMoneyStrategyTag> = {
  bulk_deal: { strategyId: "S113", strategyName: "Block/Bulk Deal Following", strategyRank: 46, tag: "S113 · bulk" },
  block_deal: { strategyId: "S113", strategyName: "Block/Bulk Deal Following", strategyRank: 46, tag: "S113 · block" },
  insider: { strategyId: "S107", strategyName: "Buybacks & Insider Buying", strategyRank: 18, tag: "S107 · insider" },
  pledge: { strategyId: "S122", strategyName: "Promoter Buying Follow", strategyRank: 25, tag: "S122 · pledge" },
};

export const SMART_MONEY_KINDS: SmartMoneyKind[] = ["bulk_deal", "block_deal", "insider", "pledge"];

export interface SmartMoneyRow {
  id: string;
  kind: SmartMoneyKind;
  symbol: string;
  securityName: string | null;
  client: string | null;
  buySell: "BUY" | "SELL" | null;
  qty: number | null;
  price: number | null;
  value: number | null;
  tradeDate: string;
  source: string;
  desc: string | null;
}

export interface SmartMoneyItem extends SmartMoneyRow {
  strategy: SmartMoneyStrategyTag;
}

export interface SmartMoneyGroup {
  symbol: string;
  securityName: string | null;
  items: SmartMoneyItem[];
}

export interface SmartMoneyMeta {
  sources: string[];
  asOf: number | null;
  stale: boolean;
  blocked: boolean;
  healthyEmpty: boolean;
}

export const STALE_AFTER_MS = 2 * 24 * 3600 * 1000;

export function isSmartMoneyKind(kind: string): kind is SmartMoneyKind {
  return (SMART_MONEY_KINDS as readonly string[]).includes(kind);
}

/** Raw DB row → API item with its jury strategy tag attached. */
export function shapeItem(row: {
  id: string;
  kind: string;
  symbol: string;
  security_name: string | null;
  client: string | null;
  buy_sell: string | null;
  qty: number | null;
  price: number | null;
  value: number | null;
  trade_date: string;
  source: string;
  desc: string | null;
}): SmartMoneyItem | null {
  if (!isSmartMoneyKind(row.kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    symbol: row.symbol,
    securityName: row.security_name,
    client: row.client,
    buySell: row.buy_sell === "BUY" || row.buy_sell === "SELL" ? row.buy_sell : null,
    qty: typeof row.qty === "number" && Number.isFinite(row.qty) ? row.qty : null,
    price: typeof row.price === "number" && Number.isFinite(row.price) ? row.price : null,
    value: typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null,
    tradeDate: row.trade_date,
    source: row.source,
    desc: row.desc ?? null,
    strategy: STRATEGY_BY_KIND[row.kind],
  };
}

/** Group rows by symbol, most recent first; groups sorted by latest date desc. */
export function groupBySymbol(rows: SmartMoneyItem[]): SmartMoneyGroup[] {
  const bySymbol = new Map<string, SmartMoneyItem[]>();
  for (const item of rows) {
    const list = bySymbol.get(item.symbol) ?? [];
    list.push(item);
    bySymbol.set(item.symbol, list);
  }
  return [...bySymbol.entries()]
    .map(([symbol, items]) => ({
      symbol,
      securityName: items.find((i) => i.securityName)?.securityName ?? null,
      items: items.sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : a.tradeDate > b.tradeDate ? -1 : 0)),
    }))
    .sort((a, b) => {
      const la = a.items[0]?.tradeDate ?? "";
      const lb = b.items[0]?.tradeDate ?? "";
      return la < lb ? 1 : la > lb ? -1 : a.symbol < b.symbol ? -1 : 1;
    });
}

export interface DealAlertPayload {
  deviceId: string;
  symbol: string;
  exchange: "NSE";
  type: "price_above";
  price: number;
}

/**
 * AC4 payload for the existing /api/alerts pipeline. Only items carrying a
 * trade price (bulk/block deals) can express a target — SAST/pledge items
 * have no execution price and return null (the UI disables the button).
 */
export function dealAlertPayload(item: SmartMoneyItem, deviceId: string): DealAlertPayload | null {
  if (item.price == null || !Number.isFinite(item.price) || item.price <= 0) return null;
  return {
    deviceId,
    symbol: item.symbol,
    exchange: "NSE",
    type: "price_above",
    price: Math.round(item.price * 100) / 100,
  };
}