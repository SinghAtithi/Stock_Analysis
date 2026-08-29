/* TASK-1376 — paper trading: a virtual ₹10L book that fills at the last
   delayed price with configurable slippage, tracks P&L vs Nifty 50 since
   the first trade, and keeps a per-trade decision journal. Everything lives
   in localStorage (niftyterm.paperBook) — no real money anywhere. */

export type Side = "buy" | "sell";

export interface PaperPosition {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  qty: number;
  avgCost: number;
  realizedPnl: number;
  firstAt: number;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  side: Side;
  qty: number;
  refPrice: number;
  fillPrice: number;
  slippagePct: number;
  time: number;
  note: string;
  realizedPnl: number | null;
}

export interface EquityPoint {
  t: number;
  bookPct: number;
  niftyPct: number;
}

export interface NiftyCandle {
  time: number;
  close: number;
}

export interface PaperBook {
  version: number;
  cash: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  slippagePct: number;
  firstTradeAt: number | null;
  niftyStart: number | null;
  curve: EquityPoint[];
  createdAt: number;
}

export interface FillOrder {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  side: Side;
  qty: number;
  refPrice: number;
  slippagePct: number;
  note: string;
  time: number;
}

export interface FillResult {
  book: PaperBook;
  trade: PaperTrade | null;
  error: string | null;
}

export const PAPER_KEY = "niftyterm.paperBook";
export const INITIAL_CASH = 1_000_000;
export const SLIPPAGE_DEFAULT = 0.001;
export const SLIPPAGE_MAX = 0.01;
export const NOTE_MAX = 500;
export const CURVE_MAX = 400;
export const CURVE_VERSION = 1;

export const newBook = (): PaperBook => ({
  version: CURVE_VERSION,
  cash: INITIAL_CASH,
  positions: [],
  trades: [],
  slippagePct: SLIPPAGE_DEFAULT,
  firstTradeAt: null,
  niftyStart: null,
  curve: [],
  createdAt: Date.now(),
});

const isFin = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isPos = (x: unknown): x is PaperPosition =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as PaperPosition).symbol === "string" &&
  typeof (x as PaperPosition).exchange === "string" &&
  isFin((x as PaperPosition).qty) &&
  isFin((x as PaperPosition).avgCost) &&
  isFin((x as PaperPosition).realizedPnl);

const isTrade = (x: unknown): x is PaperTrade =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as PaperTrade).id === "string" &&
  typeof (x as PaperTrade).symbol === "string" &&
  ((x as PaperTrade).side === "buy" || (x as PaperTrade).side === "sell") &&
  isFin((x as PaperTrade).qty) &&
  isFin((x as PaperTrade).refPrice) &&
  isFin((x as PaperTrade).fillPrice) &&
  isFin((x as PaperTrade).time) &&
  typeof (x as PaperTrade).note === "string";

const isPoint = (x: unknown): x is EquityPoint =>
  typeof x === "object" &&
  x !== null &&
  isFin((x as EquityPoint).t) &&
  isFin((x as EquityPoint).bookPct) &&
  isFin((x as EquityPoint).niftyPct);

export function sanitizeNote(raw: string): string {
  const s = String(raw ?? "").trim().slice(0, NOTE_MAX);
  return s;
}

export function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function loadBook(): PaperBook {
  if (typeof window === "undefined") return newBook();
  try {
    const raw = window.localStorage.getItem(PAPER_KEY);
    if (!raw) return newBook();
    const parsed = JSON.parse(raw) as Partial<PaperBook>;
    const positions = Array.isArray(parsed.positions)
      ? parsed.positions.filter(isPos)
      : [];
    const trades = Array.isArray(parsed.trades)
      ? parsed.trades.filter(isTrade)
      : [];
    const curve = Array.isArray(parsed.curve)
      ? parsed.curve.filter(isPoint).slice(-CURVE_MAX)
      : [];
    const slippage =
      isFin(parsed.slippagePct) && parsed.slippagePct >= 0
        ? Math.min(parsed.slippagePct, SLIPPAGE_MAX)
        : SLIPPAGE_DEFAULT;
    return {
      version: CURVE_VERSION,
      cash: isFin(parsed.cash) && parsed.cash >= 0 ? parsed.cash : INITIAL_CASH,
      positions,
      trades,
      slippagePct: slippage,
      firstTradeAt: isFin(parsed.firstTradeAt) ? parsed.firstTradeAt : null,
      niftyStart: isFin(parsed.niftyStart) ? parsed.niftyStart : null,
      curve,
      createdAt: isFin(parsed.createdAt) ? parsed.createdAt : Date.now(),
    };
  } catch {
    return newBook();
  }
}

export function saveBook(book: PaperBook): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAPER_KEY, JSON.stringify(book));
  } catch {
    /* private mode / quota — keep in-memory only */
  }
}

export function resetBook(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PAPER_KEY);
  } catch {
    /* ignore */
  }
}

export function applySlippage(price: number, side: Side, pct: number): number {
  const f = side === "buy" ? 1 + pct : 1 - pct;
  return Math.round(price * f * 100) / 100;
}

export function fillOrder(book: PaperBook, order: FillOrder): FillResult {
  if (order.type === "Index") {
    return { book, trade: null, error: "index_not_tradable" };
  }
  if (!isFin(order.qty) || order.qty <= 0) {
    return { book, trade: null, error: "qty_must_be_positive" };
  }
  if (!isFin(order.refPrice) || order.refPrice <= 0) {
    return { book, trade: null, error: "price_unavailable" };
  }

  const fillPrice = applySlippage(order.refPrice, order.side, order.slippagePct);
  const symbol = order.symbol.trim().toUpperCase();
  const trade: PaperTrade = {
    id: newId(),
    symbol,
    name: order.name || symbol,
    exchange: order.exchange,
    type: order.type,
    side: order.side,
    qty: order.qty,
    refPrice: order.refPrice,
    fillPrice,
    slippagePct: order.slippagePct,
    time: order.time,
    note: sanitizeNote(order.note),
    realizedPnl: null,
  };

  const positions = book.positions.map((p) => ({ ...p }));
  const existing = positions.find((p) => p.symbol === symbol);

  if (order.side === "buy") {
    const cost = order.qty * fillPrice;
    if (cost > book.cash) {
      return { book, trade: null, error: "not_enough_cash" };
    }
    if (existing) {
      const totalQty = existing.qty + order.qty;
      existing.avgCost = (existing.qty * existing.avgCost + cost) / totalQty;
      existing.qty = totalQty;
    } else {
      positions.push({
        symbol,
        name: trade.name,
        exchange: order.exchange,
        type: order.type,
        qty: order.qty,
        avgCost: fillPrice,
        realizedPnl: 0,
        firstAt: order.time,
      });
    }
    return {
      book: {
        ...book,
        cash: Math.round((book.cash - cost) * 100) / 100,
        positions,
        trades: [...book.trades, trade],
        firstTradeAt: book.firstTradeAt ?? order.time,
      },
      trade,
      error: null,
    };
  }

  if (!existing) {
    return { book, trade: null, error: "no_position" };
  }
  if (order.qty > existing.qty) {
    return { book, trade: null, error: "qty_exceeds_position" };
  }
  const realizedPnl = (fillPrice - existing.avgCost) * order.qty;
  trade.realizedPnl = Math.round(realizedPnl * 100) / 100;
  existing.realizedPnl = Math.round((existing.realizedPnl + realizedPnl) * 100) / 100;
  existing.qty -= order.qty;
  const kept = existing.qty > 0 ? positions : positions.filter((p) => p.symbol !== symbol);
  return {
    book: {
      ...book,
      cash: Math.round((book.cash + order.qty * fillPrice) * 100) / 100,
      positions: kept,
      trades: [...book.trades, trade],
      firstTradeAt: book.firstTradeAt ?? order.time,
    },
    trade,
    error: null,
  };
}

export function positionUnrealized(pos: PaperPosition, ltp: number): number {
  return (ltp - pos.avgCost) * pos.qty;
}

export function positionUnrealizedPct(pos: PaperPosition, ltp: number): number {
  return pos.avgCost > 0 ? (ltp / pos.avgCost - 1) * 100 : 0;
}

export function equityValue(book: PaperBook, prices: Map<string, number>): number {
  let eq = book.cash;
  for (const p of book.positions) {
    const ltp = prices.get(p.symbol);
    eq += p.qty * (ltp != null && ltp > 0 ? ltp : p.avgCost);
  }
  return eq;
}

export function bookPnlPct(equity: number): number {
  return (equity / INITIAL_CASH - 1) * 100;
}

export function niftyStartFrom(
  candles: NiftyCandle[],
  firstTradeAt: number,
): number | null {
  if (candles.length === 0) return null;
  let best: NiftyCandle | null = null;
  for (const c of candles) {
    if (c.time <= firstTradeAt) best = c;
    else break;
  }
  if (!best) best = candles[0];
  return isFin(best.close) && best.close > 0 ? best.close : null;
}

export function niftyPctNow(candles: NiftyCandle[], start: number): number | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  if (!isFin(last.close) || last.close <= 0) return null;
  return (last.close / start - 1) * 100;
}

export function niftyCurve(
  candles: NiftyCandle[],
  start: number,
): { t: number; pct: number }[] {
  const out: { t: number; pct: number }[] = [];
  for (const c of candles) {
    if (isFin(c.close) && c.close > 0) {
      out.push({ t: c.time, pct: (c.close / start - 1) * 100 });
    }
  }
  return out;
}

export function appendPoint(
  book: PaperBook,
  t: number,
  bookPct: number,
  niftyPct: number,
): PaperBook {
  if (!isFin(bookPct) || !isFin(niftyPct)) return book;
  const last = book.curve[book.curve.length - 1];
  if (
    last &&
    t - last.t < 90_000 &&
    Math.abs(bookPct - last.bookPct) < 0.0001
  ) {
    return book;
  }
  const curve = [...book.curve, { t, bookPct, niftyPct }].slice(-CURVE_MAX);
  return { ...book, curve };
}