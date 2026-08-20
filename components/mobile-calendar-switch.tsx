"use client";

import { useEffect, useState } from "react";

/**
 * List or timeline, on a phone; timeline only, on a desktop.
 *
 * The list was the only mobile view, on the reasoning that a
 * horizontal-scroll 2D timeline is hostile at 375px. That is true and
 * it was still the wrong call: the two views answer different
 * questions. "What is happening today" is a list. "Is this car free
 * next Tuesday" is a shape, and there was no way to see it on a phone
 * at all.
 *
 * So the timeline is available and awkward rather than absent. It
 * scrolls sideways inside its own container, which the page's own
 * rules already permit and which is what the desktop view does anyway.
 *
 * The choice sticks in localStorage: it is a preference about how
 * someone works, not about this visit.
 *
 * Both children are rendered once and shown or hidden with CSS rather
 * than the page rendering the timeline twice, once per breakpoint --
 * a second copy would mount a second timeline, with its own state, its
 * own resize observer and its own dialogs, permanently invisible.
 */
export function MobileCalendarSwitch({
  list,
  timeline,
  listLabel,
  timelineLabel,
  className,
}: {
  list: React.ReactNode;
  timeline: React.ReactNode;
  listLabel: string;
  timelineLabel: string;
  className?: string;
}) {
  const [mode, setMode] = useState<"list" | "timeline">("list");

  useEffect(() => {
    const saved = window.localStorage.getItem("tato.calendarMobileView");
    if (saved === "list" || saved === "timeline") setMode(saved);
  }, []);

  function choose(next: "list" | "timeline") {
    setMode(next);
    window.localStorage.setItem("tato.calendarMobileView", next);
  }

  return (
    <div className={className}>
      {/* The switch itself is a phone affordance. A desktop has room
          for the timeline and shows it unconditionally. */}
      <div className="tap-row mb-2 flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface)] p-0.5 lg:hidden">
        {(["list", "timeline"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => choose(value)}
            className={`tap-press flex-1 rounded-[5px] px-3 py-1.5 text-[12px] font-bold transition ${
              mode === value
                ? "bg-[var(--ink)] text-white"
                : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
            }`}
          >
            {value === "list" ? listLabel : timelineLabel}
          </button>
        ))}
      </div>

      <div className={mode === "list" ? "lg:hidden" : "hidden"}>{list}</div>

      {/* Bare on purpose: the timeline already owns an `overflow-auto`
          viewport with a sticky vehicle column, so wrapping it in a
          second horizontal scroller would nest scroll areas and pin
          the sticky column to the wrong ancestor -- it would scroll
          away, which is the one thing it exists not to do. */}
      <div className={mode === "timeline" ? "lg:block" : "hidden lg:block"}>{timeline}</div>
    </div>
  );
}
