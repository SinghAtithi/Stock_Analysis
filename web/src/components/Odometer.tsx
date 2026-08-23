"use client";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function Odometer({ value }: { value: number }) {
  const text = formatPrice(value);
  return (
    <span className="tabular-nums">
      <span aria-hidden>
        {[...text].map((ch, i) => {
          const d = ch >= "0" && ch <= "9" ? Number(ch) : null;
          return (
            <span
              key={i}
              className="inline-block h-[1em] overflow-hidden align-text-bottom"
            >
              {d == null ? (
                <span className="block h-[1em] leading-none">{ch}</span>
              ) : (
                <span
                  className="block transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
                  style={{
                    transform: `translateY(${-d}em)`,
                    transitionDelay: `${Math.min(i * 30, 120)}ms`,
                  }}
                >
                  {DIGITS.map((digit) => (
                    <span key={digit} className="block h-[1em] leading-none">
                      {digit}
                    </span>
                  ))}
                </span>
              )}
            </span>
          );
        })}
      </span>
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
