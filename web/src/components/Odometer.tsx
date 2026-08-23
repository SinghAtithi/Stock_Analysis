"use client";

export default function Odometer({ value }: { value: number }) {
  const text = formatPrice(value);
  return (
    <span className="tabular-nums">
      <span aria-hidden>{text}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

export function formatPrice(v: number): string {
  const parts = v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₹${parts}`;
}
