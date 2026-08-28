/* TASK-370: quiz-result CTA pair — 'We recommend Pro' must never dead-end.
 * Billing is not wired (TASK-1424): Pro preview is a manual per-device grant,
 * so the primary CTA lands on /pricing (honest copy — no card to enter) and
 * the secondary keeps users on the free product. Mount under the quiz result. */

import Link from "next/link";

export default function PlanCta() {
  return (
    <section
      aria-labelledby="plan-cta-heading"
      className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      <h2 id="plan-cta-heading" className="text-sm font-semibold tracking-wide text-paper">
        We recommend Pro
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pro raises compute ceilings for heavy users. Billing is not wired yet —
        during the research preview Pro is granted manually per device, so
        there is no card to enter and nothing to pay.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Link
          href="/pricing"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-paper px-4 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-accent"
        >
          Start with Pro preview — no card
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-surface"
        >
          Stick with Free
        </Link>
      </div>
    </section>
  );
}