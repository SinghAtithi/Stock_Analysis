import { redirect } from "next/navigation";

/* /s/[symbol] is now the company profile (TASK-58); keep the short URL as a
 * permanent-style redirect. The per-symbol OG card stays mounted alongside. */

const UP_SYM = (s: string) => decodeURIComponent(s).trim().toUpperCase();

export default async function SharePage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  redirect(`/company/${encodeURIComponent(UP_SYM(raw))}`);
}
