"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export type DashboardDayTab = "yesterday" | "today" | "tomorrow" | "recent";

/**
 * The dashboard's day panels on a phone: one at a time behind a row of
 * tabs -- yesterday, today, tomorrow, recently viewed -- rather than four
 * lists stacked down the page, where tomorrow's handovers sat three
 * screens below today's. Opens on today.
 *
 * The panels themselves stay server-rendered in the page; this only
 * holds which one shows, as `data-active` on a `group/days` wrapper that
 * each panel's classes read (DAY_TAB_PANEL in the dashboard page). From
 * `lg` up every panel shows in the three columns and the tabs are gone.
 */
export function DashboardDayTabs({
  tabs,
  children,
}: {
  tabs: Array<{ key: DashboardDayTab; label: string; count?: number | null }>;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<DashboardDayTab>("today");
  return (
    <div className="group/days space-y-2" data-active={active}>
      <div role="tablist" className="grid grid-cols-4 gap-1 rounded-lg bg-[var(--surface-muted)] p-1 lg:hidden">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(tab.key)}
              className={cn(
                "tap-press tap-compact flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-1 text-[12.5px]",
                on
                  ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "font-medium text-[var(--ink-soft)]",
              )}
            >
              <span className="truncate">{tab.label}</span>
              {tab.count ? <span className="tabular-nums opacity-70">{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
