import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms — NIFTY//TERM",
  description: "Terms of use for the research terminal.",
};

const SECTIONS = [
  {
    h: "01 — USE OF THE SERVICE",
    p: [
      "NIFTY//TERM is provided free of charge as a research and education tool for Indian equity markets. You may use it for personal, non-commercial purposes.",
    ],
  },
  {
    h: "02 — NO WARRANTY",
    p: [
      "The service is provided 'as is' without warranties of any kind, express or implied, including accuracy, completeness, availability, or fitness for a particular purpose.",
    ],
  },
  {
    h: "03 — LIMITATION OF LIABILITY",
    p: [
      "To the maximum extent permitted by law, the maintainers shall not be liable for any direct, indirect, incidental, or consequential damages arising from use of this service.",
    ],
  },
  {
    h: "04 — THIRD-PARTY DATA",
    p: [
      "Market data and signals derive from third-party public sources. Providers may change, restrict, or discontinue access at any time. The service may become unavailable without notice.",
    ],
  },
  {
    h: "05 — CHANGES",
    p: [
      "These terms may be updated at any time. Continued use of the service constitutes acceptance of the current terms.",
    ],
  },
];

export default function TermsPage() {{
  return (
    <div className="min-h-dvh">
      <SiteHeader subtitle="Terms" subtitleClassName="font-normal text-muted" />
      <LegalPage
        title="Terms"
        lede="Fair use of the terminal and its data."
        sections={[
  {
    h: "01 — USE OF THE SERVICE",
    p: [
      "NIFTY//TERM is provided free of charge as a research and education tool for Indian equity markets. You may use it for personal, non-commercial purposes.",
    ],
  },
  {
    h: "02 — NO WARRANTY",
    p: [
      "The service is provided 'as is' without warranties of any kind, express or implied, including accuracy, completeness, availability, or fitness for a particular purpose.",
    ],
  },
  {
    h: "03 — LIMITATION OF LIABILITY",
    p: [
      "To the maximum extent permitted by law, the maintainers shall not be liable for any direct, indirect, incidental, or consequential damages arising from use of this service.",
    ],
  },
  {
    h: "04 — THIRD-PARTY DATA",
    p: [
      "Market data and signals derive from third-party public sources. Providers may change, restrict, or discontinue access at any time. The service may become unavailable without notice.",
    ],
  },
  {
    h: "05 — CHANGES",
    p: [
      "These terms may be updated at any time. Continued use of the service constitutes acceptance of the current terms.",
    ],
  },
]}
        updated="2026-08-16"
      />
    </div>
  );
}}
