import Link from "next/link";

/* TASK-96: shared shell for the legal pages — token-driven prose, sentence
   case headings, SiteHeader nav so these pages stop being a dead end.
   Copy lives in each page; this component owns only the presentation. */

export interface LegalSection {
  h: string;
  p: string[];
}

export default function LegalPage({
  title,
  lede,
  sections,
  updated,
}: {
  title: string;
  lede: string;
  sections: LegalSection[];
  updated: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-paper sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted">{lede}</p>
      <div className="mt-8">
        {sections.map((s) => (
          <section key={s.h} className="mt-8 border-t border-line pt-6">
            <h2 className="text-base font-semibold text-paper">{s.h}</h2>
            {s.p.map((para) => (
              <p key={para.slice(0, 32)} className="mt-3 text-sm leading-relaxed text-muted">
                {para}
              </p>
            ))}
          </section>
        ))}
      </div>
      <footer className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-xs text-faint">
        <Link href="/privacy" className="underline decoration-line underline-offset-2 transition-colors hover:text-muted">
          Privacy
        </Link>
        <Link href="/terms" className="underline decoration-line underline-offset-2 transition-colors hover:text-muted">
          Terms
        </Link>
        <Link href="/pricing" className="underline decoration-line underline-offset-2 transition-colors hover:text-muted">
          Pricing
        </Link>
        <span>Last updated · {updated}</span>
      </footer>
    </main>
  );
}
