"use client";

import Link from "next/link";
import useISTClock from "@/hooks/useISTClock";
import MarketStatus from "@/components/MarketStatus";
import ThemeToggle from "@/components/ThemeToggle";

interface SiteHeaderProps {
  subtitle: string;
  subtitleClassName?: string;
  sticky?: boolean;
  nav?: boolean;
  onHelp?: () => void;
}

export default function SiteHeader({
  subtitle,
  subtitleClassName = "ml-1 hidden text-xs font-normal text-muted sm:inline",
  sticky = false,
  nav = false,
  onHelp,
}: SiteHeaderProps) {
  const clock = useISTClock();
  return (
    <header
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-6 ${
        sticky ? "sticky top-0 z-30 bg-surface/80 backdrop-blur" : "bg-surface"
      }`}
    >
      <Link href="/" className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-[11px] font-bold tracking-widest text-ink">
          N
        </span>
          <span className="text-sm font-semibold tracking-tight text-paper">
            NIFTY
            <span className={subtitleClassName}>{subtitle}</span>
          </span>
      </Link>

      {nav && (
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          <Link
            href="/screener"
            className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-paper"
          >
            Screener
          </Link>
          <Link
            href="/breadth"
            className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-paper"
          >
            Breadth
          </Link>
          <Link
            href="/board"
            className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm"
          >
            Board
          </Link>
        </nav>
      )}

      <div
        className={`flex items-center ${nav ? "gap-2 sm:gap-3" : "gap-3 sm:gap-4"}`}
      >
        <span className="hidden font-mono text-xs tabular-nums text-faint sm:inline">
          {clock ? `${clock} IST` : "—"}
        </span>
        <MarketStatus />
        <ThemeToggle />
        {!nav && (
          <>
            <Link
              href="/board"
              className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium text-ink shadow-sm"
            >
              Board
            </Link>
            <Link
              href="/"
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-paper hover:bg-panel-2"
            >
              ← Terminal
            </Link>
          </>
        )}
        {onHelp && (
          <button
            onClick={onHelp}
            aria-label="Keyboard shortcuts"
            className="hidden h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-paper sm:inline-flex"
          >
            ?
          </button>
        )}
      </div>
    </header>
  );
}
