"use client";

/* Device-scoped saved screener views (TASK-62): named snapshots of
   {strategy, sort} in localStorage, applied via picker or ?sort=&dir= URL.
   Same storage discipline as lib/watchlist.ts — cached stable snapshots for
   useSyncExternalStore, custom event + storage event subscription. */

export type SortDir = "asc" | "desc";

export interface ScreenerPreset {
  id: string;
  name: string;
  strategy: string;
  sortKey: string | null;
  sortDir: SortDir;
  createdAt: number;
}

export interface ScreenerViewSnapshot {
  strategy: string;
  sortKey: string | null;
  sortDir: SortDir;
}

export const SCREENER_PRESETS_KEY = "niftyterm.screener-presets.v1";
export const SCREENER_PRESETS_EVENT = "niftyterm:screener-presets";
const MAX_PRESETS = 20;
const MAX_NAME = 40;

const isPreset = (x: unknown): x is ScreenerPreset =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as ScreenerPreset).id === "string" &&
  (x as ScreenerPreset).id.length > 0 &&
  typeof (x as ScreenerPreset).name === "string" &&
  typeof (x as ScreenerPreset).strategy === "string" &&
  ((x as ScreenerPreset).sortKey === null ||
    typeof (x as ScreenerPreset).sortKey === "string") &&
  ((x as ScreenerPreset).sortDir === "asc" ||
    (x as ScreenerPreset).sortDir === "desc");

const normalize = (p: ScreenerPreset): ScreenerPreset => ({
  id: p.id,
  name: p.name.slice(0, MAX_NAME),
  strategy: p.strategy,
  sortKey: p.sortKey,
  sortDir: p.sortDir,
  createdAt:
    typeof p.createdAt === "number" && Number.isFinite(p.createdAt)
      ? p.createdAt
      : 0,
});

/* Pure filter used by parseRaw and covered by node:test. */
export function sanitizePresets(raw: unknown): ScreenerPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPreset).map(normalize);
}

const parseRaw = (raw: string): ScreenerPreset[] => {
  try {
    return sanitizePresets(JSON.parse(raw));
  } catch {
    return [];
  }
};

/* stable snapshots for useSyncExternalStore — same reference while unchanged */
let snapshotRaw: string | null = null;
let snapshotList: ScreenerPreset[] = [];

export function getScreenerPresetsSnapshot(): ScreenerPreset[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SCREENER_PRESETS_KEY);
  } catch {
    raw = null;
  }
  if (raw === snapshotRaw) return snapshotList;
  snapshotRaw = raw;
  snapshotList = raw === null ? [] : parseRaw(raw);
  return snapshotList;
}

export function getServerPresetsSnapshot(): ScreenerPreset[] {
  return [];
}

const write = (list: ScreenerPreset[]): boolean => {
  const json = JSON.stringify(list);
  snapshotList = list;
  try {
    window.localStorage.setItem(SCREENER_PRESETS_KEY, json);
    snapshotRaw = json;
  } catch {
    /* quota / private mode — keep in-memory only; caller surfaces a warning
       (TASK-776) */
    window.dispatchEvent(new CustomEvent(SCREENER_PRESETS_EVENT));
    return false;
  }
  window.dispatchEvent(new CustomEvent(SCREENER_PRESETS_EVENT));
  return true;
};

/* Save a view snapshot under `name`; an existing preset with the same name is
   replaced. Newest first, capped at MAX_PRESETS. Returns the stored list. */
export function saveScreenerPreset(
  name: string,
  snap: ScreenerViewSnapshot,
): boolean {
  if (typeof window === "undefined") return false;
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed || !snap.strategy) return false;
  const current = getScreenerPresetsSnapshot().filter((p) => p.name !== trimmed);
  const preset: ScreenerPreset = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    name: trimmed,
    strategy: snap.strategy,
    sortKey: snap.sortKey,
    sortDir: snap.sortDir,
    createdAt: Date.now(),
  };
  /* true when the write persisted — false lets the UI warn about private
     mode / quota (TASK-776) */
  return write([preset, ...current].slice(0, MAX_PRESETS));
}

export function deleteScreenerPreset(id: string): void {
  if (typeof window === "undefined") return;
  write(getScreenerPresetsSnapshot().filter((p) => p.id !== id));
}

/* TASK-386: undo for delete — re-insert a just-deleted preset at its old
   position (clamped), so a mis-tap loses nothing. Returns true when the
   write persisted. */
export function restoreScreenerPreset(
  preset: ScreenerPreset,
  index = 0,
): boolean {
  if (typeof window === "undefined") return false;
  const current = getScreenerPresetsSnapshot().filter((p) => p.id !== preset.id);
  const i = Math.max(0, Math.min(index, current.length));
  current.splice(i, 0, preset);
  return write(current);
}

export function subscribeScreenerPresets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === SCREENER_PRESETS_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(SCREENER_PRESETS_EVENT, cb as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SCREENER_PRESETS_EVENT, cb as EventListener);
  };
}
