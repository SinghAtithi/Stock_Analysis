"use client";

import { useEffect, useRef, useState } from "react";

const DIGITS = "0123456789";

function Digit({ ch, animate }: { ch: string; animate: boolean }) {
  const idx = DIGITS.indexOf(ch);
  if (idx === -1) return <span className="odometer-digit w-auto">{ch}</span>;
  return (
    <span className="odometer-digit" aria-hidden>
      <span
        className="odometer-strip"
        style={{
          transform: `translateY(-${idx}em)`,
          transition: animate ? undefined : "none",
        }}
      >
        {DIGITS.split("").map((d) => (
          <span key={d} className="block h-[1em] leading-none">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function Odometer({ value }: { value: number }) {
  const [text, setText] = useState(() => formatPrice(value));
  const prevText = useRef(text);
  const [animate, setAnimate] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const next = formatPrice(value);
    if (next === prevText.current) return;
    setText(next);
    if (!first.current) {
      setAnimate(true);
      const t = setTimeout(() => setAnimate(false), 750);
      return () => clearTimeout(t);
    }
    first.current = false;
    prevText.current = next;
  }, [value]);

  useEffect(() => {
    prevText.current = text;
  }, [text]);

  return (
    <span className="tabular-nums inline-flex items-baseline">
      <span aria-hidden className="inline-flex items-baseline">
        {text.split("").map((ch, i) => (
          <Digit key={i} ch={ch} animate={animate} />
        ))}
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
