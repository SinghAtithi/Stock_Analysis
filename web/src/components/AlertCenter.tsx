"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";
import { PRICE_TYPES } from "@/lib/alerts";
import { getDeviceId } from "@/lib/device";
import { timeAgo } from "@/lib/format";

const POLL_MS = 30_000;

/* TASK-453: ids of fired alerts the consumer has already seen (dialog opened).
 * Persisted so a page reload doesn't re-ring the bell for old news. */
const SEEN_FIRED_KEY = "niftyterm.alerts.seenFired";

function loadSeenFired(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SEEN_FIRED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
    );
  } catch {
    return new Set();
  }
}

function saveSeenFired(seen: Set<string>): void {
  try {
    window.localStorage.setItem(SEEN_FIRED_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    /* quota / private mode — badge just resets next visit */
  }
}

interface AlertRecord {
  id: string;
  symbol: string | null;
  strategyId: string | null;
  topN: number | null;
  exchange: string;
  type: string;
  price: number | null;
  active: boolean;
  createdAt: number;
  firedAt: number | null;
  dismissedAt?: number | null;
  detail?: string | null;
}

interface Props {
  symbol: string;
  exchange: string;
  /** TASK-372: current price from the loaded chart payload, when available */
  price?: number | null;
}

const TYPE_LABELS: Record<string, string> = {
  price_above: "Price crosses above",
  price_below: "Price crosses below",
  strategy_enter: "Enters strategy top-N",
  strategy_exit: "Leaves strategy top-N",
};

const firedVerb = (type: string): string =>
  type === "price_below" ? "crossed below" : "crossed above";

/* TASK-182: membership fires carry a persisted detail string
 * ("S100 top-10: entered RELIANCE, TCS") — render that instead of the
 * price-cross copy that produced "null crossed above". */
const isMembership = (a: AlertRecord): boolean =>
  a.type === "strategy_enter" || a.type === "strategy_exit";

const firedCopy = (a: AlertRecord): string => {
  if (isMembership(a)) {
    return (
      a.detail ??
      `${a.strategyId ?? "strategy"} top-${a.topN ?? "N"} ${
        a.type === "strategy_enter" ? "entry" : "exit"
      }`
    );
  }
  return `${firedVerb(a.type)} ${a.price ?? ""}`;
};

const firedTone = (a: AlertRecord): "up" | "down" =>
  a.type === "strategy_exit" || a.type === "price_below" ? "down" : "up";

const alertTitle = (a: AlertRecord): string =>
  a.strategyId
    ? `${a.strategyId} top-${a.topN ?? "N"} ${a.type === "strategy_enter" ? "entry" : "exit"}`
    : `${a.symbol ?? "Symbol"} · ${TYPE_LABELS[a.type] ?? a.type}`;

function BellIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export default function AlertCenter({ symbol, exchange, price }: Props) {
  const [open, setOpen] = useState(false);  const [createOpen, setCreateOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /* TASK-453: fired-but-unseen tracking (persisted per device) */
  const [seenFired, setSeenFired] = useState<Set<string>>(() => loadSeenFired());
  const activeIdsRef = useRef<Set<string>>(new Set());

  const applyAlerts = useCallback((rows: AlertRecord[]) => {
    const prevActive = activeIdsRef.current;
    const newlyFired = rows.filter(
      (r) => !r.active && r.firedAt != null && prevActive.has(r.id),
    );
    if (newlyFired.length > 0) {
      setAnnouncement(
        newlyFired
          .map((f) => `${f.symbol ? `${f.symbol} ` : ""}${firedCopy(f)}`)
          .join("; "),
      );
    }
    activeIdsRef.current = new Set(
      rows.filter((r) => r.active).map((r) => r.id),
    );
    setAlerts(rows);
    setLoadedOnce(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(
          `/api/alerts?deviceId=${encodeURIComponent(getDeviceId())}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as { alerts?: AlertRecord[] };
        if (!cancelled) applyAlerts(json.alerts ?? []);
      } catch {
        /* offline — next tick retries */
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyAlerts]);

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(
        `/api/alerts?deviceId=${encodeURIComponent(getDeviceId())}`,
      );
      if (!res.ok) {
        setListError("Could not load alerts");
        return;
      }
      const json = (await res.json()) as { alerts?: AlertRecord[] };
      applyAlerts(json.alerts ?? []);
    } catch {
      setListError("Could not load alerts");
    }
  }, [applyAlerts]);

  const removeAlert = async (id: string) => {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(
        `/api/alerts?deviceId=${encodeURIComponent(getDeviceId())}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("delete_failed");
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setListError("Could not remove alert");
    } finally {
      setBusyId(null);
    }
  };

  /* Dismissing a fired alert archives it (TASK-963) — the row stays on the
     server (dismissed_at) and moves to the Dismissed section locally. */
  const dismissFired = async (id: string) => {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(
        `/api/alerts?deviceId=${encodeURIComponent(getDeviceId())}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("dismiss_failed");
      const json = (await res.json().catch(() => ({}))) as {
        archived?: boolean;
        dismissedAt?: number;
      };
      if (json.archived) {
        const at = typeof json.dismissedAt === "number" ? json.dismissedAt : null;
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, dismissedAt: at ?? a.firedAt } : a)),
        );
      } else {
        /* legacy server without archive support — old behavior */
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch {
      setListError("Could not dismiss alert");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAlert = async (id: string, next: boolean): Promise<void> => {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), id, active: next }),
      });
      if (!res.ok) throw new Error("patch_failed");
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, active: next } : a)));
    } catch {
      setListError("Could not update alert");
    } finally {
      setBusyId(null);
    }
  };

  const active = alerts.filter((a) => a.active);
  const fired = alerts.filter(
    (a) => !a.active && a.firedAt != null && a.dismissedAt == null,
  );
  /* TASK-1010: one-tap re-arm — PATCH active=1 (server clears fired_at);
     the row moves to Active with its original target intact */
  const reArm = async (id: string): Promise<void> => {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: getDeviceId(), id, active: true }),
      });
      if (!res.ok) throw new Error("rearm_failed");
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, active: true, firedAt: null } : a)),
      );
    } catch {
      setListError("Could not re-arm alert");
    } finally {
      setBusyId(null);
    }
  };
  /* TASK-453: fired alerts the consumer hasn't seen yet drive the bell badge */
  const unseenFired = fired.filter((a) => !seenFired.has(a.id));
  const openCenter = () => {
    setOpen(true);
    if (fired.length > 0) {
      const next = new Set(seenFired);
      fired.forEach((a) => next.add(a.id));
      setSeenFired(next);
      saveSeenFired(next);
    }
  };
  const dismissed = alerts
    .filter((a) => !a.active && a.dismissedAt != null)
    .sort((a, b) => (b.dismissedAt ?? 0) - (a.dismissedAt ?? 0));

  return (
    <>
      <button
        type="button"
        onClick={openCenter}
        aria-label={
          unseenFired.length > 0
            ? `Alert center, ${unseenFired.length} newly fired, ${active.length} active`
            : active.length > 0
              ? `Alert center, ${active.length} active`
              : "Alert center"
        }
        aria-haspopup="dialog"
        title="Alerts"
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-paper after:absolute after:-inset-1.5 after:content-['']"
      >
        <BellIcon />
        {unseenFired.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 font-mono text-[10px] font-semibold tabular-nums text-paper">
            {unseenFired.length}
          </span>
        ) : active.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-paper px-1 font-mono text-[10px] font-semibold tabular-nums text-ink">
            {active.length}
          </span>
        ) : null}
      </button>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {(open || createOpen) &&
        createPortal(
          <>
            <Modal open={open} onClose={() => setOpen(false)} label="Alert center">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
          <span className="text-sm font-semibold text-paper">Alerts</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-ink shadow-sm transition-opacity hover:opacity-90"
            >
              New alert
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close alert center"
              className="rounded-full border border-line bg-surface px-2 py-1 text-sm text-muted hover:text-paper"
            >
              ✕
            </button>
          </div>
        </div>

        {listError && (
          <p className="mb-3 rounded-lg bg-down-soft px-3 py-2 text-xs text-down" role="alert">
            {listError}
          </p>
        )}

        {!loadedOnce ? (
          <p className="py-6 text-center text-xs text-faint">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <section aria-label="Active alerts">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted">Active</p>
              {active.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-faint">
                  No active alerts — create one from {symbol || "any symbol"}.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {active.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-paper">{alertTitle(a)}</p>
                        {!a.strategyId && (
                          <p className="mt-0.5 font-mono text-xs tabular-nums text-muted">
                            @ {a.price ?? "—"} · {a.exchange}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <ToggleAlert
                          id={a.id}
                          active={a.active}
                          busy={busyId === a.id}
                          onToggle={(tid, next) => void toggleAlert(tid, next)}
                        />
                        <button
                          type="button"
                          onClick={() => void removeAlert(a.id)}
                          disabled={busyId === a.id}
                          aria-label={`Delete alert for ${a.strategyId ?? a.symbol}`}
                          className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:text-down disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {fired.length > 0 && (
              <section aria-label="Fired alerts">
                <p className="mb-2 text-xs font-medium tracking-wide text-muted">Fired</p>
                <ul className="flex flex-col gap-2">
                  {fired.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        {isMembership(a) ? (
                          <p className="truncate text-sm text-paper">
                            <span
                              className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                firedTone(a) === "up"
                                  ? "bg-up-soft text-up"
                                  : "bg-down-soft text-down"
                              }`}
                            >
                              {a.type === "strategy_enter" ? "entered" : "exited"}
                            </span>
                            {firedCopy(a)}
                          </p>
                        ) : (
                          <p className="truncate text-sm text-paper">
                            <span className="font-mono text-xs font-medium">{a.symbol}</span>
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                                a.type === "price_below"
                                  ? "bg-down-soft text-down"
                                  : "bg-up-soft text-up"
                              }`}
                            >
                              {firedCopy(a)}
                            </span>
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-faint">{timeAgo(a.firedAt)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void reArm(a.id)}
                          disabled={busyId === a.id}
                          aria-label={`Re-arm alert: ${isMembership(a) ? (a.detail ?? `${a.strategyId ?? "strategy"} ${a.type}`) : `${a.symbol} ${firedVerb(a.type)} ${a.price ?? ""}`}`}
                          title="Re-arm for the next cross"
                          className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-ink shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          Re-arm
                        </button>
                        <button
                          type="button"
                          onClick={() => void dismissFired(a.id)}
                          disabled={busyId === a.id}
                          aria-label={`Dismiss fired alert: ${isMembership(a) ? (a.detail ?? `${a.strategyId ?? "strategy"} ${a.type}`) : a.symbol}`}
                          className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:text-paper disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {dismissed.length > 0 && (
              <section aria-label="Dismissed alerts">
                <p className="mb-2 text-xs font-medium tracking-wide text-faint">
                  Dismissed
                </p>
                <ul className="flex flex-col gap-1.5">
                  {dismissed.slice(0, 10).map((a) => (
                    <li
                      key={a.id}
                      className="flex items-baseline justify-between gap-3 rounded-xl border border-dashed border-line px-3 py-2 opacity-80"
                    >
                      <p className="min-w-0 truncate text-xs text-muted">
                        <span className="font-mono">{a.symbol ?? a.strategyId}</span>
                        <span className="ml-2">{firedCopy(a)}</span>
                      </p>
                      <p className="shrink-0 text-[11px] text-faint tabular-nums">
                        {timeAgo(a.dismissedAt ?? a.firedAt)}
                      </p>
                    </li>
                  ))}
                  {dismissed.length > 10 && (
                    <li className="px-3 text-[11px] text-faint">
                      +{dismissed.length - 10} earlier kept in history
                    </li>
                  )}
                </ul>
              </section>
            )}
          </div>
        )}
          </Modal>

          <CreateAlertDialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            symbol={symbol}
            exchange={exchange}
            currentPrice={price ?? null}
            onCreated={() => void refresh()}
          />
        </>,
        document.body,
      )}
    </>
  );
}

function CreateAlertDialog({
  open,
  onClose,
  symbol,
  exchange,
  currentPrice,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  symbol: string;
  exchange: string;
  currentPrice: number | null;
  onCreated: () => void;
}) {

  const [type, setType] = useState<string>(PRICE_TYPES[0]);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fmtINR = (v: number): string =>
    `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  /* TASK-372 AC3: soft relative validation — warn but never block submit */
  const targetNum = Number(price);
  const relativeWarning =
    currentPrice != null &&
    price.trim() !== "" &&
    Number.isFinite(targetNum) &&
    targetNum > 0
      ? type === "price_above" && targetNum <= currentPrice
        ? `Target is at or below the current ${fmtINR(currentPrice)} — “crosses above” may fire immediately.`
        : type === "price_below" && targetNum >= currentPrice
          ? `Target is at or above the current ${fmtINR(currentPrice)} — “crosses below” may fire immediately.`
          : null
      : null;

  const reset = () => {
    setType(PRICE_TYPES[0]);
    setPrice("");
    setError(null);
  };

  const submit = async () => {
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(value) || value <= 0) {
      setError("Enter a valid price above zero");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          symbol,
          exchange,
          type,
          price: value,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          json.error === "db_unavailable"
            ? "Alert service unavailable — try again shortly"
            : "Could not create alert",
        );
        return;
      }
      reset();
      onClose();
      onCreated();
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      label="Create alert"
    >
      <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
        <span className="text-sm font-semibold text-paper">New price alert</span>
        <button
          type="button"
          onClick={() => {
            reset();
            onClose();
          }}
          aria-label="Close create alert"
          className="rounded-full border border-line bg-surface px-2 py-1 text-sm text-muted hover:text-paper"
        >
          ✕
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Symbol</span>
          <span className="rounded-full bg-paper px-2.5 py-1 font-mono text-xs font-medium tabular-nums text-ink">
            {symbol || "—"}
          </span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs text-muted">
            {exchange}
          </span>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Condition</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper focus-visible:outline-2 focus-visible:outline-accent"
          >
            {/* TASK-200: only advertise types this dialog can actually create —
                membership alerts need strategyId+topN and have no create UI yet */}
            {PRICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        {currentPrice != null && (
          <p className="text-xs text-muted">
            Current: <span className="font-mono tabular-nums text-paper">{fmtINR(currentPrice)}</span>
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Target price (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            placeholder={currentPrice != null ? String(Math.round(currentPrice * 100) / 100) : "0.00"}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            aria-describedby={relativeWarning ? "alert-relative-hint" : undefined}
            className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-right font-mono text-sm tabular-nums text-paper focus-visible:outline-2 focus-visible:outline-accent"
          />
          <span className="text-[11px] leading-relaxed text-faint">
            {currentPrice != null
              ? `Enter above ${fmtINR(currentPrice)} for “crosses above”, below for “crosses below”.`
              : "Enter the level the price should cross."}
          </span>
        </label>
        {relativeWarning && (
          <p id="alert-relative-hint" className="text-xs text-faint">
            {relativeWarning}
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs text-down">
            {error}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:text-paper"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !symbol}
            className="rounded-full bg-paper px-3.5 py-1.5 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Create alert
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* TASK-59 — per-alert pause/resume via PATCH; parent owns list state */
function ToggleAlert({
  id,
  active,
  busy,
  onToggle,
}: {
  id: string;
  active: boolean;
  busy: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id, !active)}
      disabled={busy}
      aria-pressed={!active}
      aria-label={active ? "Pause alert" : "Resume alert"}
      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted transition-colors hover:text-paper disabled:opacity-50"
    >
      {active ? "Pause" : "Resume"}
    </button>
  );
}
