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
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors after:absolute after:-inset-1.5 after:content-[''] ${
        inList
          ? /* TASK-193: token-driven starred state (was tailwind amber) */
            "border-accent/30 bg-accent-soft text-accent"
          : "border-line bg-surface text-faint hover:border-line-strong hover:text-paper"
      }`}
    >
      <Star size={14} strokeWidth={1.6} fill={inList ? "currentColor" : "none"} />
    </button>
  );
}
