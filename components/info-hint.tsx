"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The explanation, on request.
 *
 * Every panel in this product carries a paragraph of grey text under
 * its heading explaining what it does. That paragraph earns its place
 * the first time and costs vertical space every time after — and it is
 * read as noise long before it is read as help, which means the one
 * panel whose explanation genuinely matters is skipped along with the
 * rest.
 *
 * So it moves behind a question mark next to the heading. Nothing is
 * deleted; the reasoning is one click away for as long as it is
 * wanted, and invisible once it is not.
 */
export function InfoHint({ text, label = "?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="tap-compact inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--line)] text-[10px] font-bold leading-none text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.3)] hover:text-[var(--ink)]"
      >
        {label}
      </button>

      {open ? (
        /* Anchored to the button and pinned to a readable width. Left
           to size itself it would take the width of the heading it
           sits beside, which for a two-word heading is a column of
           single words. */
        <span className="absolute left-0 top-6 z-50 w-[min(22rem,80vw)] rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[11.5px] font-normal leading-5 text-[var(--ink)] shadow-[0_18px_40px_-20px_rgba(17,19,24,0.4)]">
          {text}
        </span>
      ) : null}
    </span>
  );
}
