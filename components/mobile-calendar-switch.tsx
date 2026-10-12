"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Mode = "list" | "timeline";
const SwitchContext = createContext<{
  mode: Mode;
  choose: (mode: Mode) => void;
  labels: { list: string; timeline: string };
} | null>(null);

/**
 * 日历 | 列表, as a small segmented control. Each view draws it in its
 * own top row -- the timeline beside ‹ Today ›, the list beside its day
 * strip -- rather than the switch taking a row of its own above both.
 */
/** Which view the phone is showing; null outside the switch. */
export function useCalendarViewMode(): Mode | null {
  return useContext(SwitchContext)?.mode ?? null;
}

export function CalendarViewToggle({ className }: { className?: string }) {
  const context = useContext(SwitchContext);
  if (!context) return null;
  return (
    <div className={cn("flex shrink-0 rounded-lg bg-[var(--surface-muted)] p-0.5 lg:hidden", className)}>
      {(["timeline", "list"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => context.choose(value)}
          aria-pressed={context.mode === value}
          className={cn(
            "tap-compact hit-area flex h-[26px] items-center rounded-md px-3 text-[12px]",
            context.mode === value
              ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              : "text-[var(--ink-soft)]",
          )}
        >
          {value === "list" ? context.labels.list : context.labels.timeline}
        </button>
      ))}
    </div>
  );
}

/**
 * Calendar or list, on a phone; calendar only, on a desktop.
 *
 * The calendar -- the same group timeline a desktop shows -- is the
 * default. It used to be the second tab with the list first, and the
 * operator read that as "a phone only gets a list". The storage key was
 * bumped with that change, so a phone that once saved "list" starts on
 * the calendar again and can still choose the list.
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
const STORAGE_KEY = "tato.calendarMobileView.v2";

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
  const [mode, setMode] = useState<Mode>("timeline");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "list" || saved === "timeline") setMode(saved);
    } catch {
      // Private mode or blocked storage: the default stands.
    }
  }, []);

  function choose(next: "list" | "timeline") {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered, still switched.
    }
  }

  return (
    <SwitchContext.Provider value={{ mode, choose, labels: { list: listLabel, timeline: timelineLabel } }}>
    <div className={className}>
      <div className={mode === "list" ? "lg:hidden" : "hidden"}>{list}</div>

      {/* Bare on purpose: the timeline already owns an `overflow-auto`
          viewport with a sticky vehicle column, so wrapping it in a
          second horizontal scroller would nest scroll areas and pin
          the sticky column to the wrong ancestor -- it would scroll
          away, which is the one thing it exists not to do. */}
      <div className={mode === "timeline" ? "lg:block" : "hidden lg:block"}>{timeline}</div>
    </div>
    </SwitchContext.Provider>
  );
}
