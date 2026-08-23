/**
 * Alerts v1 (ROADMAP T25 backend slice) — pure logic shared by the API
 * routes and tests. No I/O here.
 */

export const ALERT_TYPES = ["price_above", "price_below"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertInput {
  deviceId: string;
  symbol: string;
  exchange: string;
  type: AlertType;
  price: number;
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
  symbol: string;
  type: AlertType;
  target: number;
  price: number;
  firedAt: number;
}

interface AlertPayload {
  symbol?: string;
  exchange?: string;
  price?: number;
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

export function validateAlertInput(body: unknown): { ok: true; value: AlertInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_json" };
  const b = body as Record<string, unknown>;

  const deviceId = typeof b.deviceId === "string" ? b.deviceId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(deviceId)) return { ok: false, error: "invalid_device_id" };

  const symbol = typeof b.symbol === "string" ? b.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9 .^=&_-]{1,32}$/.test(symbol)) return { ok: false, error: "invalid_symbol" };

  const exchange = typeof b.exchange === "string" && b.exchange.trim() ? b.exchange.trim().toUpperCase() : "NSE";
  if (!["NSE", "BSE"].includes(exchange)) return { ok: false, error: "invalid_exchange" };

  const type = b.type as AlertType;
  if (!ALERT_TYPES.includes(type)) return { ok: false, error: "invalid_type" };

  const price = Number(b.price);
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "invalid_price" };

  return {
    ok: true,
    value: { deviceId, symbol, exchange, type, price },
  };
}
