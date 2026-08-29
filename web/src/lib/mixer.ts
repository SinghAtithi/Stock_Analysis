"use client";

/* Device-scoped saved strategy mixes (TASK-1377): named weight sets over
   jury-ranked strategies, stored in localStorage. Same discipline as
   lib/screenerPresets.ts — stable snapshots for useSyncExternalStore,
   custom event + storage event subscription. The screener preset schema
   ({strategy, sortKey, sortDir}) cannot hold a weights list, so mixes keep
   their own storage key under the same naming convention. The pure weight
   math lives in lib/mixerMath.ts (server-safe — /api/mixer calls it). */

import { MAX_MIX_STRATEGIES } from "./mixerMath";
import type { MixWeight } from "./mixerMath";

export { MAX_MIX_STRATEGIES, normalizeWeights } from "./mixerMath";
export type { MixWeight } from "./mixerMath";

export interface MixPreset {
  id: string;
  name: string;
  weights: MixWeight[];
  createdAt: number;
}

export const MIX_PRESETS_KEY = "niftyterm.mixer-presets.v1";
export const MIX_PRESETS_EVENT = "niftyterm:mixer-presets";
export const MAX_MIX_PRESETS = 20;
export const MAX_MIX_NAME = 40;

const isWeight = (x: unknown): x is MixWeight =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as MixWeight).strategyId === "string" &&
  (x as MixWeight).strategyId.length > 0 &&
  typeof (x as MixWeight).weight === "number" &&
  Number.isFinite((x as MixWeight).weight);

const isMixPreset = (x: unknown): x is MixPreset =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as MixPreset).id === "string" &&
  (x as MixPreset).id.length > 0 &&
  typeof (x as MixPreset).name === "string" &&
  Array.isArray((x as MixPreset).weights) &&
  /* at least one valid weight — presets whose entries are all junk are
     useless and dropped */
  (x as MixPreset).weights.some(isWeight);

const normalize = (p: MixPreset): MixPreset => ({
  id: p.id,
  name: p.name.slice(0, MAX_MIX_NAME),
  weights: p.weights.filter(isWeight).slice(0, MAX_MIX_STRATEGIES),
  createdAt:
    typeof p.createdAt === "number" && Number.isFinite(p.createdAt)
      ? p.createdAt
      : 0,
});

/* Pure filter used by parseRaw and covered by node:test. */
export function sanitizeMixPresets(raw: unknown): MixPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isMixPreset).map(normalize);
}

const parseRaw = (raw: string): MixPreset[] => {
  try {
    return sanitizeMixPresets(JSON.parse(raw));
  } catch {
    return [];
  }
};

/* stable snapshots for useSyncExternalStore — same reference while unchanged */
let snapshotRaw: string | null = null;
let snapshotList: MixPreset[] = [];

/* module-level constant so the server snapshot reference never changes
   (React 19 warns/loops on uncached getServerSnapshot results) */
const EMPTY_MIX_PRESETS: MixPreset[] = [];

export function getMixPresetsSnapshot(): MixPreset[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MIX_PRESETS_KEY);
  } catch {
    raw = null;
  }
  if (raw === snapshotRaw) return snapshotList;
  snapshotRaw = raw;
  snapshotList = raw === null ? [] : parseRaw(raw);
  return snapshotList;
}

export function getServerMixPresetsSnapshot(): MixPreset[] {
  return EMPTY_MIX_PRESETS;
}

const write = (list: MixPreset[]): boolean => {
  const json = JSON.stringify(list);
  snapshotList = list;
  try {
    window.localStorage.setItem(MIX_PRESETS_KEY, json);
    snapshotRaw = json;
  } catch {
    /* quota / private mode — keep in-memory only; caller surfaces a warning */
    window.dispatchEvent(new CustomEvent(MIX_PRESETS_EVENT));
    return false;
  }
  window.dispatchEvent(new CustomEvent(MIX_PRESETS_EVENT));
  return true;
};

/* Save a mix under `name`; an existing preset with the same name is
   replaced. Newest first, capped at MAX_MIX_PRESETS. Returns true when the
   write persisted (false lets the UI warn about private mode / quota). */
export function saveMixPreset(name: string, weights: MixWeight[]): boolean {
  if (typeof window === "undefined") return false;
  const trimmed = name.trim().slice(0, MAX_MIX_NAME);
  const kept = weights
    .filter(isWeight)
    .filter((x) => x.weight >= 0.5)
    .slice(0, MAX_MIX_STRATEGIES);
  if (!trimmed || kept.length === 0) return false;
  const current = getMixPresetsSnapshot().filter((p) => p.name !== trimmed);
  const preset: MixPreset = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `m${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    name: trimmed,
    weights: kept,
    createdAt: Date.now(),
  };
  return write([preset, ...current].slice(0, MAX_MIX_PRESETS));
}

export function deleteMixPreset(id: string): void {
  if (typeof window === "undefined") return;
  write(getMixPresetsSnapshot().filter((p) => p.id !== id));
}

/* Undo for delete — re-insert a just-deleted preset at its old position
   (clamped), so a mis-tap loses nothing. Returns true when persisted. */
export function restoreMixPreset(preset: MixPreset, index = 0): boolean {
  if (typeof window === "undefined") return false;
  const current = getMixPresetsSnapshot().filter((p) => p.id !== preset.id);
  const i = Math.max(0, Math.min(index, current.length));
  current.splice(i, 0, preset);
  return write(current);
}

export function subscribeMixPresets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === MIX_PRESETS_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(MIX_PRESETS_EVENT, cb as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MIX_PRESETS_EVENT, cb as EventListener);
  };
}