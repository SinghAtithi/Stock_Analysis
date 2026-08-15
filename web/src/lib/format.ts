const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function inrCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${num.format(v / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${num.format(v / 1e5)} L`;
  return inr.format(v);
}

export function volumeCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${num.format(v / 1e7)} Cr`;
  if (abs >= 1e5) return `${num.format(v / 1e5)} L`;
  if (abs >= 1e3) return `${num.format(v / 1e3)} K`;
  return num.format(v);
}

export function timeAgo(unixSec: number | null | undefined): string {
  if (!unixSec) return "—";
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixSec * 1000).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
