import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy — NIFTY//TERM",
  description: "What we store, what we never collect.",
};

const SECTIONS = [
  {
    h: "01 — NO ACCOUNTS, NO PII",
    p: [
      "NIFTY//TERM does not require accounts, email addresses, or any personal information. There is no sign-up, no login, and no profile.",
    ],
  },
  {
    h: "02 — LOCAL STORAGE ONLY",
    p: [
      "Your watchlist lives in your browser's localStorage under the key niftyterm.watchlist. It never leaves your device. Clearing your browser data removes it; you can also export and import it as JSON from the watchlist panel.",
    ],
  },
  {
    h: "03 — NO ANALYTICS, NO TRACKING",
    p: [
      "The site ships no analytics, advertising, or third-party tracking scripts. Requests to data endpoints (Yahoo, NSE, etc.) happen server-side and contain no personal identifiers beyond your IP address, which those providers may log.",
    ],
  },
  {
    h: "04 — EXTERNAL LINKS",
    p: [
      "Charts and data attribute third-party providers whose own privacy policies apply to their services.",
    ],
  },
];

export default function PrivacyPage() {{
  return (
    <div className="min-h-dvh">
      <SiteHeader subtitle="Privacy" subtitleClassName="font-normal text-muted" />
      <LegalPage
        title="Privacy"
        lede="No accounts, no trackers, no selling data."
        sections={[
  {
    h: "01 — NO ACCOUNTS, NO PII",
    p: [
      "NIFTY//TERM does not require accounts, email addresses, or any personal information. There is no sign-up, no login, and no profile.",
    ],
  },
  {
    h: "02 — LOCAL STORAGE ONLY",
    p: [
      "Your watchlist lives in your browser's localStorage under the key niftyterm.watchlist. It never leaves your device. Clearing your browser data removes it; you can also export and import it as JSON from the watchlist panel.",
    ],
  },
  {
    h: "03 — NO ANALYTICS, NO TRACKING",
    p: [
      "The site ships no analytics, advertising, or third-party tracking scripts. Requests to data endpoints (Yahoo, NSE, etc.) happen server-side and contain no personal identifiers beyond your IP address, which those providers may log.",
    ],
  },
  {
    h: "04 — EXTERNAL LINKS",
    p: [
      "Charts and data attribute third-party providers whose own privacy policies apply to their services.",
    ],
  },
]}
        updated="2026-08-16"
      />
    </div>
  );
}}
