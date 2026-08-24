import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { HELP_CHILDREN } from "./nav";

export const metadata: Metadata = {
  title: "Help — NIFTY//TERM",
  description:
    "Getting started, score explanations, plan limits, data sources and delays, and the glossary for NIFTY.",
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader subtitle="Help" subtitleClassName="ml-1 hidden text-xs font-normal text-muted sm:inline" />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-8 sm:px-6"
      >
        {children}
      </main>
      <footer className="border-t border-line px-4 py-4 text-xs text-faint sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1">
          {HELP_CHILDREN.map((c) => (
            <Link key={c.href} href={c.href} className="hover:text-muted">
              {c.title}
            </Link>
          ))}
          <span className="ml-auto">NIFTY · Help</span>
        </div>
      </footer>
    </div>
  );
}
