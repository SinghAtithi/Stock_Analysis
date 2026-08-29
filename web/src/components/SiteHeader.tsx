"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useISTClock from "@/hooks/useISTClock";
import MarketStatus from "@/components/MarketStatus";
import ThemeToggle from "@/components/ThemeToggle";
import AlertCenter from "@/components/AlertCenter";
import Search from "@/components/Search";

interface SiteHeaderProps {
  subtitle: string;
  subtitleClassName?: string;
  sticky?: boolean;
  onHelp?: () => void;
  alerts?: { symbol: string; exchange: string; price?: number | null } | null;
}

/* TASK-166: one nav row on every route — desktop inline, drawer on mobile */
const NAV_LINKS = [
  { href: "/screener", label: "Screener" },
  { href: "/breadth", label: "Breadth" },
  { href: "/backtest", label: "Backtest" },
  { href: "/board", label: "Board" },
  { href: "/help", label: "Help" },
] as const;

export default function SiteHeader({
  subtitle,
  subtitleClassName = "ml-1 hidden text-xs font-normal text-muted sm:inline",
  sticky = false,
  onHelp,
  alerts = null,
}: SiteHeaderProps) {
  const clock = useISTClock();
  const pathname = usePathname();
  const router = useRouter();
  /* TASK-113: symbol search reachable on every subpage — selecting routes to
     the terminal with that symbol loaded; home keeps its inline terminal search */
  const isHome = pathname === "/";
  const pickFromHeader = (r: { symbol: string; exchange: string }) =>
    router.push(`/?s=${encodeURIComponent(r.symbol)}&e=${encodeURIComponent(r.exchange)}&r=1y`);
  const navClassName = (href: string) =>
    `rounded-full px-3 py-1.5 text-sm transition-colors ${
      pathname === href
        ? "bg-paper font-medium text-ink shadow-sm"
        : "text-muted hover:bg-panel-2 hover:text-paper"
    }`;
  return (
    <header
      className={`flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-3 sm:flex-nowrap sm:px-6 ${
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

      {!isHome && (
        <div className="order-first w-full basis-full px-0 sm:order-none sm:w-44 sm:basis-auto">
          <Search onSelect={pickFromHeader} />
        </div>
      )}

      <nav className="hidden items-center gap-1 sm:flex" aria-label="Site">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className={navClassName(link.href)}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 sm:gap-3">
        {alerts && <AlertCenter symbol={alerts.symbol} exchange={alerts.exchange} price={"price" in alerts ? alerts.price : null} />}
        <span className="hidden font-mono text-xs tabular-nums text-faint sm:inline">
          {clock ? `${clock} IST` : "—"}
        </span>
        <MarketStatus />
        <ThemeToggle />
        {onHelp && (
          <button
            onClick={onHelp}
            aria-label="Keyboard shortcuts"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-paper after:absolute after:-inset-1.5 after:content-['']"
          >
            ?
          </button>
        )}
      </div>
      <nav
        aria-label="Site"
        className="-mx-4 flex w-full basis-full gap-1 overflow-x-auto border-t border-line px-4 pb-2 pt-2 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className={`shrink-0 ${navClassName(link.href)}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}