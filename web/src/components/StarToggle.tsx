"use client";

import { Star } from "lucide-react";

interface Props {
  inList: boolean;
  onToggle: () => void;
}

export default function StarToggle({ inList, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={inList}
      aria-label={inList ? "Remove from watchlist" : "Add to watchlist"}
      title={inList ? "Remove from watchlist" : "Add to watchlist"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${
        inList
          ? "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
          : "border-line bg-surface text-faint hover:border-line-strong hover:text-paper"
      }`}
    >
      <Star size={14} strokeWidth={1.6} fill={inList ? "currentColor" : "none"} />
    </button>
  );
}
