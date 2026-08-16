"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  sheet?: boolean;
  panelClassName?: string;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  label,
  children,
  sheet = false,
  panelClassName = "",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () => panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 ${sheet ? "" : "flex items-center justify-center p-4"}`}
    >
      <button
        aria-label={`Close ${label.toLowerCase()}`}
        className="absolute inset-0 h-full w-full bg-ink/70"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={
          sheet
            ? `animate-sheet-up absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto border-t border-hairline-strong bg-ink p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_48px_-12px_rgba(0,0,0,0.8)] ${panelClassName}`
            : `animate-fade-up relative max-w-md w-full border border-hairline-strong bg-ink p-6 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)] ${panelClassName}`
        }
      >
        {children}
      </div>
    </div>
  );
}
