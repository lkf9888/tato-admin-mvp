"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { TAB_BAR_CLASS, tabBadgeClass, tabClass } from "@/components/direct-booking-nav";

export type DirectBookingTab = {
  key: string;
  label: string;
  /** A count or a short status, shown beside the label. */
  badge?: string | number | null;
  panel: ReactNode;
};

/** A tab that is another page rather than a panel here. */
export type DirectBookingTabLink = {
  key: string;
  label: string;
  href: string;
  badge?: string | number | null;
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
  links = [],
  initialTab,
  label,
}: {
  tabs: DirectBookingTab[];
  links?: DirectBookingTabLink[];
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
    for (const key of [
      "policySaved",
      "locationsSaved",
      "emailSaved",
      "agreementSaved",
      "agreementError",
      "couponCreated",
      "couponError",
    ]) {
      params.delete(key);
    }
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
        className={TAB_BAR_CLASS}
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
              className={tabClass(selected)}
            >
              {tab.label}
              {tab.badge != null && tab.badge !== "" ? (
                <span className={tabBadgeClass(selected)}>{tab.badge}</span>
              ) : null}
            </button>
          );
        })}
        {links.map((link) => (
          <Link key={link.key} href={link.href} className={tabClass(false)}>
            {link.label}
            {link.badge != null && link.badge !== "" ? (
              <span className={tabBadgeClass(false)}>{link.badge}</span>
            ) : null}
          </Link>
        ))}
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
