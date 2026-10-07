"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 *
 * The bubble is drawn on the page itself (a portal to <body>), not
 * inside the panel: a card with `overflow: hidden` or a scrolling table
 * used to cut it off. It sits under the "?" -- or above it when there is
 * no room below -- and is kept inside the screen's edges.
 */

const GAP = 6;
const EDGE = 8;

export function InfoHint({ text, label = "?" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  // Place it before it is painted, so it never flashes at the corner.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    function place() {
      const button = buttonRef.current?.getBoundingClientRect();
      const bubble = bubbleRef.current?.getBoundingClientRect();
      if (!button || !bubble) return;
      const below = button.bottom + GAP;
      const top =
        below + bubble.height > window.innerHeight - EDGE && button.top - GAP - bubble.height > EDGE
          ? button.top - GAP - bubble.height
          : below;
      const left = Math.min(Math.max(button.left, EDGE), window.innerWidth - bubble.width - EDGE);
      setPosition({ top, left: Math.max(EDGE, left) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !bubbleRef.current?.contains(target)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDocumentDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onDocumentDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="tap-compact inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--line)] text-[10px] font-bold leading-none text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.3)] hover:text-[var(--ink)]"
      >
        {label}
      </button>

      {open
        ? createPortal(
            /* Pinned to a readable width. Left to size itself it would
               take the width of the heading it sits beside, which for a
               two-word heading is a column of single words. */
            <span
              ref={bubbleRef}
              id={id}
              role="tooltip"
              style={{
                position: "fixed",
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                visibility: position ? "visible" : "hidden",
              }}
              className="z-[100] block w-[min(22rem,calc(100vw-1rem))] rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[11.5px] font-normal normal-case leading-5 tracking-normal text-[var(--ink)] shadow-[0_18px_40px_-20px_rgba(17,19,24,0.4)]"
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
