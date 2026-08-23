import Link from "next/link";
import { HELP_CHILDREN } from "./nav";

export default function HelpHubPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-paper sm:text-2xl">Help</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        Short answers about how NIFTY works — scores, plans, data quality and the
        vocabulary of systematic investing.
      </p>
      <ul className="mt-6 grid gap-3">
        {HELP_CHILDREN.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              className="block rounded-2xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-line-strong"
            >
              <span className="text-sm font-medium text-paper">{c.title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">{c.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
