"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type DirectBookingTab = {
  key: string;
  label: string;
  /** A count or a short status, shown beside the label. */
  badge?: string | number | null;
  panel: ReactNode;
};

/**
 * The direct-booking page's sections as tabs.
 *
 * Every panel stays mounted and only the active one is shown, so an
 * edit half-made in the pricing rules survives a look at the car list.
 * The active tab is in the URL (`?tab=`), which is also how a save that
 * redirects comes back to the tab it was made on.
 */
export function DirectBookingTabs({
  tabs,
  initialTab,
  label,
}: {
  tabs: DirectBookingTab[];
  initialTab: string;
  label: string;
}) {
  const fallback = tabs[0]?.key ?? "";
  const [active, setActive] = useState(
    tabs.some((tab) => tab.key === initialTab) ? initialTab : fallback,
  );
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (active === fallback) params.delete("tab");
    else params.set("tab", active);
    // A save notice belongs to the visit that made the save; leaving the
    // tab should not bring it back on the next reload.
    for (const key of ["policySaved", "locationsSaved", "emailSaved"]) params.delete(key);
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(window.history.state, "", next);
  }, [active, fallback]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((tab) => tab.key === active);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    setActive(next.key);
    buttons.current.get(next.key)?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-1 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
      >
        {tabs.map((tab) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(node) => {
                if (node) buttons.current.set(tab.key, node);
                else buttons.current.delete(tab.key);
              }}
              type="button"
              role="tab"
              id={`direct-booking-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`direct-booking-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                selected
                  ? "bg-[var(--ink)] text-white"
                  : "text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)]"
              }`}
            >
              {tab.label}
              {tab.badge != null && tab.badge !== "" ? (
                <span
                  className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                    selected ? "bg-white/20 text-white" : "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]"
                  }`}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`direct-booking-panel-${tab.key}`}
          aria-labelledby={`direct-booking-tab-${tab.key}`}
          hidden={tab.key !== active}
          className="space-y-3"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
