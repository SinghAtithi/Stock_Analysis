import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Strategy mixer — NIFTY//TERM",
  description:
    "Build your own jury composite: weight top-ranked strategies with sliders into a personal score, saved per device.",
};

export default function MixerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader
        subtitle="Strategy mixer"
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