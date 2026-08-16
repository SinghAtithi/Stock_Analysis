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
      className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center border transition-colors duration-100 ${
        inList
          ? "border-up/40 bg-up/10 text-up"
          : "border-hairline bg-panel text-faint hover:text-paper"
      }`}
    >
      <Star size={13} strokeWidth={1.5} fill={inList ? "currentColor" : "none"} />
    </button>
  );
}
