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

let openModals = 0;
let savedOverflow = "";
let savedPaddingRight = "";

function lockBodyScroll() {
  if (openModals === 0) {
    const { body } = document;
    savedOverflow = body.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    body.style.overflow = "hidden";
  }
  openModals += 1;
}

function unlockBodyScroll() {
  openModals -= 1;
  if (openModals === 0) {
    document.body.style.overflow = savedOverflow;
    document.body.style.paddingRight = savedPaddingRight;
  }
}

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
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

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
        className="absolute inset-0 h-full w-full bg-black/50 backdrop-blur-[2px] dark:bg-black/60"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={
          sheet
            ? `absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5 shadow-md ${panelClassName}`
            : `relative w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-md ${panelClassName}`
        }
        style={
          sheet ? { paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" } : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
