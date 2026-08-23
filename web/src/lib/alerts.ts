/**
 * Alerts v1+v2 (ROADMAP T25) — pure logic shared by the API routes,
 * the CLI evaluator and tests. No I/O here.
 */

export const PRICE_TYPES = ["price_above", "price_below"] as const;
export const MEMBERSHIP_TYPES = ["strategy_enter", "strategy_exit"] as const;
export const ALERT_TYPES = [...PRICE_TYPES, ...MEMBERSHIP_TYPES] as const;
export type PriceAlertType = (typeof PRICE_TYPES)[number];
export type MembershipAlertType = (typeof MEMBERSHIP_TYPES)[number];
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertInput {
  deviceId: string;
  symbol?: string;
  exchange: string;
  type: AlertType;
  price?: number;
  strategyId?: string;
  topN?: number;
}

/** Fires when the price reaches or crosses the threshold. */
export function crossFired(type: AlertType, target: number, current: number): boolean {
  if (!Number.isFinite(current)) return false;
  return type === "price_above" ? current >= target : current <= target;
}

export interface ActiveAlertRow {
  id: string;
  device_id: string;
  type: string;
  payload_json: string;
}

export interface FiredAlert {
  id: string;
  deviceId: string;
  symbol?: string;
  strategyId?: string;
  type: AlertType;
  target?: number;
  price?: number;
  detail?: string;
  firedAt: number;
}

interface AlertPayload {
  symbol?: string;
  exchange?: string;
  price?: number;
  strategyId?: string;
  topN?: number;
}

export function isMembershipType(type: string): boolean {
  return (MEMBERSHIP_TYPES as readonly string[]).includes(type);
}

/**
 * What DELETE /api/alerts should do with a row (TASK-963): fired alerts are
 * archived (dismissed_at stamp, row retained for the journal) while every
 * other row — including manually deactivated ones — keeps the original
 * hard-delete behavior.
 */
export function alertDeletePlan(row: {
  active: number | boolean;
  fired_at: number | null;
}): "hard" | "archive" {
  return !row.active && row.fired_at != null ? "archive" : "hard";
}

/**
 * Top-N membership diff between two consecutive snapshot runs.
 * `entered` = in current but not previous; `exited` = vice versa.
 */
export function membershipDiff(
  prevTop: string[],
  currTop: string[]
): { entered: string[]; exited: string[] } {
  const prev = new Set(prevTop);
  const curr = new Set(currTop);
  return {
    entered: currTop.filter((s) => !prev.has(s)),
    exited: prevTop.filter((s) => !curr.has(s)),
  };
}

/**
 * Pure evaluation pass: given active rows and current prices, returns the
 * alerts that fired (and must be marked inactive by the caller). Rows whose
 * symbol has no price this pass, whose payload is unreadable, or whose
 * stored type/target are invalid are skipped silently — they stay pending.
 */
export function evaluatePass(
  rows: ActiveAlertRow[],
  priceBySymbol: Map<string, number>,
  now: number
): FiredAlert[] {
  const fired: FiredAlert[] = [];
  for (const row of rows) {
    if (isMembershipType(row.type)) continue; // handled by membershipEvents
    let payload: AlertPayload | null = null;
    try {
      payload = JSON.parse(row.payload_json) as AlertPayload;
    } catch {
      continue;
    }
    const target = Number(payload?.price);
    const symbol = String(payload?.symbol ?? "").toUpperCase();
    if (!symbol || !Number.isFinite(target)) continue;
    const current = priceBySymbol.get(symbol);
    if (current === undefined || !crossFired(row.type as AlertType, target, current)) continue;
    fired.push({
      id: row.id,
      deviceId: row.device_id,
      symbol,
      type: row.type as AlertType,
      target,
      price: current,
      firedAt: now,
    });
  }
  return fired;
}

/**
 * Strategy-membership evaluation: an alert fires when a watched strategy's
 * top-N gains or loses a symbol between the two latest snapshot runs.
 * `membership` maps strategyId → {entered, exited} for the newest diff
 * (computed by the caller from signal_snapshots — see evaluate route).
 */
export function membershipEvents(
  rows: ActiveAlertRow[],
  membership: Map<string, { entered: string[]; exited: string[] }>,
  now: number
): FiredAlert[] {
  const fired: FiredAlert[] = [];
  for (const row of rows) {
    if (!isMembershipType(row.type)) continue;
    let payload: AlertPayload | null = null;
    try {
      payload = JSON.parse(row.payload_json) as AlertPayload;
    } catch {
      continue;
    }
    const strategyId = String(payload?.strategyId ?? "");
    const diff = membership.get(strategyId);
    if (!diff) continue;
    const wantsEnter = row.type === "strategy_enter";
    const symbols = wantsEnter ? diff.entered : diff.exited;
    if (symbols.length === 0) continue;
    fired.push({
      id: row.id,
      deviceId: row.device_id,
      strategyId,
      type: row.type as MembershipAlertType,
      detail:
        `${strategyId} top-${payload?.topN ?? "N"}: ` +
        `${wantsEnter ? "entered" : "exited"} ${symbols.join(", ")}`,
      symbol: undefined,
      firedAt: now,
    });
  }
  return fired;
}

export function validateAlertInput(
  body: unknown,
  knownStrategies?: Set<string>
): { ok: true; value: AlertInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_json" };
  const b = body as Record<string, unknown>;

  const deviceId = typeof b.deviceId === "string" ? b.deviceId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(deviceId)) return { ok: false, error: "invalid_device_id" };

  const exchange = typeof b.exchange === "string" && b.exchange.trim() ? b.exchange.trim().toUpperCase() : "NSE";
  if (!["NSE", "BSE"].includes(exchange)) return { ok: false, error: "invalid_exchange" };

  const type = b.type as AlertType;
  const isMembership = typeof type === "string" && isMembershipType(type);

  if (isMembership) {
    // strategy-membership alerts: payload is {strategyId, topN}, no symbol/price
    const strategyId = typeof b.strategyId === "string" ? b.strategyId.trim() : "";
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(strategyId)) return { ok: false, error: "invalid_strategy" };
    if (knownStrategies && !knownStrategies.has(strategyId)) {
      return { ok: false, error: "unknown_strategy" };
    }
    const topN = Number(b.topN ?? 10);
    if (!Number.isInteger(topN) || topN < 1 || topN > 50) {
      return { ok: false, error: "invalid_top_n" };
    }
    return {
      ok: true,
      value: { deviceId, exchange, type, strategyId, topN },
    };
  }

  // price-cross alerts: payload is {symbol, price}
  const symbol = typeof b.symbol === "string" ? b.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9 .^=&_-]{1,32}$/.test(symbol)) return { ok: false, error: "invalid_symbol" };

  if (!ALERT_TYPES.includes(type)) return { ok: false, error: "invalid_type" };

  const price = Number(b.price);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "invalid_price" };

  return {
    ok: true,
    value: { deviceId, symbol, exchange, type, price },
  };
}
