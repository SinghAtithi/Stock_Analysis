"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Skeleton from "@/components/Skeleton";
import { getDeviceId } from "@/lib/device";
import {
  getServerWatchlistSnapshot,
  getWatchlistSnapshot,
  subscribeWatchlist,
} from "@/lib/watchlist";
import { useWatchlistMirror } from "@/lib/watchlistMirror";
import {
  dealAlertPayload,
  SmartMoneyGroup,
  SmartMoneyItem,
  SmartMoneyMeta,
} from "@/lib/smartMoney";

type Tab = "watchlist" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "watchlist", label: "Watchlist" },
  { id: "all", label: "All activity" },
];

type AlertState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "ok" }
  | { status: "error"; message: string };

const inr = (v: number | null): string =>
  v == null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")}`;

const qtyOf = (v: number | null): string =>
  v == null ? "—" : Math.round(v).toLocaleString("en-IN");

const priceOf = (v: number | null): string =>
  v == null ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateOf = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const KIND_LABEL: Record<string, string> = {
  bulk_deal: "Bulk deal",
  block_deal: "Block deal",
  insider: "Insider trade",
  pledge: "Pledge change",
};

export default function RadarPage() {
  useWatchlistMirror();
  const watchlist = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    getServerWatchlistSnapshot,
  );
  const watchSymbols = useMemo(
    () => new Set(watchlist.map((e) => e.symbol)),
    [watchlist],
  );

  const [groups, setGroups] = useState<SmartMoneyGroup[]>([]);
  const [meta, setMeta] = useState<SmartMoneyMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("watchlist");
  const [alerts, setAlerts] = useState<Map<string, AlertState>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/smart-money");
        if (!res.ok) throw new Error("radar_failed");
        const json = (await res.json()) as {
          groups: SmartMoneyGroup[];
          meta: SmartMoneyMeta;
        };
        if (!cancelled) {
          setGroups(json.groups ?? []);
          setMeta(json.meta ?? null);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => (tab === "all" ? groups : groups.filter((g) => watchSymbols.has(g.symbol))),
    [groups, tab, watchSymbols],
  );

  const setAlertFor = (itemId: string, next: AlertState) => {
    setAlerts((prev) => new Map(prev).set(itemId, next));
  };

  const alertOnDeal = async (item: SmartMoneyItem) => {
    const payload = dealAlertPayload(item, getDeviceId());
    if (!payload) {
      setAlertFor(item.id, {
        status: "error",
        message: "This item carries no trade price — open the company page to set a target.",
      });
      return;
    }
    setAlertFor(item.id, { status: "busy" });
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string; limit?: number };
        const message =
          json.error === "alert_cap_reached"
            ? `Free plan allows ${typeof json.limit === "number" ? json.limit : 5} active alerts — remove one or upgrade.`
            : json.error === "db_unavailable"
              ? "Alert service unavailable — try again shortly."
              : "Could not create alert.";
        setAlertFor(item.id, { status: "error", message });
        return;
      }
      setAlertFor(item.id, { status: "ok" });
      window.setTimeout(() => setAlertFor(item.id, { status: "idle" }), 4000);
    } catch {
      setAlertFor(item.id, { status: "error", message: "Network error — try again." });
    }
  };

  const alertStateOf = (itemId: string): AlertState => alerts.get(itemId) ?? { status: "idle" };
  const alertAnnouncement = [...alerts.entries()]
    .filter(([, s]) => s.status === "ok" || s.status === "error")
    .map(([id, s]) =>
      s.status === "ok"
        ? `${id}: alert set`
        : s.status === "error"
          ? `${id}: ${s.message}`
          : "",
    )
    .filter(Boolean)
    .join("; ");

  const watchlistEmpty = tab === "watchlist" && watchSymbols.size === 0;
  const blocked = meta?.blocked === true;
  const healthyEmpty = meta?.healthyEmpty === true;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader subtitle="Smart-money radar" subtitleClassName="font-normal text-muted" />

      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">
          <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Smart-money radar</h1>
          <p className="mt-1 text-sm text-muted">
            Block and bulk deals, insider (SAST) filings and promoter pledge changes, mapped to the jury
            strategies that follow them.
          </p>
          <p className="mt-3 inline-flex min-h-[1.65rem] items-center gap-2 rounded-full border border-line bg-panel-2 px-3 py-1 text-xs text-muted">
            {loading ? (
              <Skeleton className="h-3 w-48" />
            ) : meta ? (
              <>
                <span>
                  {meta.sources.length > 0 ? meta.sources.join(" + ") : "NSE publication feeds"}
                  {meta.asOf ? ` · as of ${dateOf(new Date(meta.asOf).toISOString().slice(0, 10))}` : ""}
                </span>
                {meta.stale && (
                  <span className="rounded-full bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-faint">
                    stale
                  </span>
                )}
              </>
            ) : (
              <span>Feed unavailable</span>
            )}
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-down/20 bg-down-soft px-4 py-3 text-sm text-down">
            Radar feed unreachable — showing last known data, if any.
          </p>
        )}

        <div role="group" aria-label="Universe" className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-paper bg-paper text-ink shadow-sm"
                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-1 rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs tabular-nums text-faint">
            {loading ? "…" : `${visible.length} symbols`}
          </span>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {alertAnnouncement}
        </div>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 w-full rounded-md" />
          </div>
        ) : watchlistEmpty ? (
          <section className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">Your watchlist is empty</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Add stocks to your watchlist to see block/bulk deals, insider filings and pledge changes for
              them here.
            </p>
            <Link
              href="/?s=RELIANCE"
              className="mt-4 inline-block rounded-full bg-paper px-4 py-1.5 text-sm font-medium text-ink shadow-sm transition-opacity hover:opacity-90"
            >
              Open the watchlist
            </Link>
          </section>
        ) : blocked ? (
          <section className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">Source blocked/offline — data unavailable today</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              The exchange publication feed refused the request. The radar resumes automatically once the
              source responds.
            </p>
          </section>
        ) : healthyEmpty ? (
          <section className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">No smart-money activity recorded yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Bulk/block deals, SAST filings and pledge intimations appear here as the exchange publishes
              them.
            </p>
          </section>
        ) : visible.length === 0 ? (
          <section className="rounded-lg border border-dashed border-line bg-surface px-5 py-12 text-center">
            <p className="text-sm font-medium text-paper">No smart-money activity for your watchlist</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Nothing in the recent feed matches your watchlist symbols yet.
            </p>
          </section>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((g) => (
              <section key={g.symbol} aria-label={`${g.symbol} smart-money activity`}>
                <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-panel-2 px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <Link
                        href={`/company/${g.symbol}.NS`}
                        className="font-mono text-sm font-medium tabular-nums text-paper hover:text-muted focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {g.symbol}
                      </Link>
                      {g.securityName && <p className="truncate text-xs text-faint">{g.securityName}</p>}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-faint">{g.items.length} event{g.items.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_6.5rem_7rem_auto] gap-3 border-b border-line bg-surface px-4 py-2 text-[11px] font-medium text-faint sm:grid">
                    <span>Date</span>
                    <span>Event</span>
                    <span>Counterparty</span>
                    <span>Side</span>
                    <span className="text-right">Quantity</span>
                    <span className="text-right">Value</span>
                    <span className="text-right">Actions</span>
                  </div>
                  <ul>
                    {g.items.map((item, i) => {
                      const a = alertStateOf(item.id);
                      const canAlert = item.price != null && item.price > 0;
                      return (
                        <li
                          key={item.id}
                          className={`grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_6.5rem_7rem_auto] ${
                            i > 0 ? "border-t border-line" : ""
                          }`}
                        >
                          <span className="font-mono text-xs tabular-nums text-muted">{dateOf(item.tradeDate)}</span>
                          <div className="min-w-0">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-sm font-medium text-paper">{KIND_LABEL[item.kind] ?? item.kind}</span>
                              <span className="rounded-full border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-faint">
                                {item.strategy.tag}
                              </span>
                            </span>
                            {item.desc && <p className="mt-0.5 truncate text-xs text-faint">{item.desc}</p>}
                          </div>
                          <span className="col-start-2 row-start-2 text-xs text-muted sm:col-auto sm:row-auto">
                            {item.client ?? "—"}
                            {item.price != null && (
                              <span className="ml-1.5 font-mono text-[11px] tabular-nums text-faint">@{priceOf(item.price)}</span>
                            )}
                          </span>
                          <span
                            className={`col-start-2 row-start-3 font-mono text-xs font-medium tabular-nums sm:col-auto sm:row-auto ${
                              item.buySell === "BUY" ? "text-up" : item.buySell === "SELL" ? "text-down" : "text-faint"
                            }`}
                          >
                            {item.buySell ?? "—"}
                          </span>
                          <span className="col-start-2 row-start-4 font-mono text-xs tabular-nums text-paper sm:col-auto sm:row-auto">
                            {qtyOf(item.qty)}
                          </span>
                          <span className="col-start-2 row-start-5 font-mono text-xs tabular-nums text-paper sm:col-auto sm:row-auto">
                            {inr(item.value)}
                          </span>
                          <div className="col-start-2 row-start-6 flex flex-wrap items-center justify-end gap-1.5 sm:col-auto sm:row-auto">
                            <button
                              type="button"
                              onClick={() => void alertOnDeal(item)}
                              disabled={!canAlert || a.status === "busy"}
                              aria-label={`Alert on new deal for ${g.symbol}`}
                              title={
                                canAlert
                                  ? `Fires when ${g.symbol} trades at or above the deal price`
                                  : "No trade price for this item — set a target from the company page"
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                a.status === "ok"
                                  ? "border-up bg-up-soft text-up"
                                  : "border-line bg-surface text-muted hover:border-line-strong hover:text-paper"
                              }`}
                            >
                              {a.status === "busy" ? "Setting…" : a.status === "ok" ? "Alert set" : "Alert on deal"}
                            </button>
                          </div>
                          {a.status === "error" && (
                            <p role="alert" className="col-span-2 col-start-1 row-start-7 text-xs text-down sm:col-span-3 sm:col-start-2">
                              {a.message}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-faint">
          <span>
            Sources · {meta?.sources.length ? meta.sources.join(", ") : "NSE bulk/block + SAST/pledge announcements"}
            {meta?.asOf ? ` · as of ${dateOf(new Date(meta.asOf).toISOString().slice(0, 10))}` : ""}
          </span>
          <Link href="/disclaimer" className="underline decoration-line underline-offset-2 hover:text-muted">
            Not investment advice
          </Link>
        </footer>
      </main>
    </div>
  );
}