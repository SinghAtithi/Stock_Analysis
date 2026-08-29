import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Tax lot planner — NIFTY//TERM",
  description:
    "STCG/LTCG split per lot, holding-period countdown and a what-if sale simulator for Indian equity holdings. Estimates only — consult a CA.",
};

export default function TaxLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader
        subtitle="Tax lot planner"
        subtitleClassName="ml-1 hidden text-xs font-normal text-muted sm:inline"
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8 sm:px-6"
      >
        {children}
      </main>
    </div>
  );
}