"use client";

import {
  CalendarDays,
  Car,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * iOS-style bottom tab bar for the admin shell on mobile. Five slots —
 * four direct destinations + a "More" button that pops the rest of the
 * navigation as a sheet. Hidden on `lg` and above; the desktop sidebar
 * takes over there.
 *
 * Active state is driven by `usePathname` so a deep route under the
 * tab (e.g. /vehicles/edit/foo) still keeps the parent tab highlighted.
 *
 * The bar pins to the bottom and adds `pb-safe` (env(safe-area-inset-
 * bottom)) so it sits *above* the iOS home indicator instead of under
 * it. Pages that scroll need bottom padding equivalent to the bar's
 * height plus the safe-area inset, applied in the AppShell `<main>`.
 */

type SidebarItem = { href: string; label: string };

export function BottomTabBar({
  labels,
  moreItems,
  moreFooter,
}: {
  labels: {
    home: string;
    calendar: string;
    orders: string;
    fleet: string;
    more: string;
    moreTitle: string;
  };
  // The 'More' sheet renders every nav row that didn't fit in the four
  // tabs. Passed down from AppShell so the source of truth for the
  // total nav stays in one place.
  moreItems: SidebarItem[];
  // Slot at the bottom of the More sheet for non-nav controls
  // (language switcher, sign-out, version chip, etc.) so the mobile
  // shell exposes everything the desktop sidebar does without needing
  // a second drawer.
  moreFooter?: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();

  // Close the More sheet on route change so it doesn't linger across
  // navigations.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Lock background scroll when the More sheet is open. Same pattern
  // as the existing MobileNav drawer.
  useEffect(() => {
    if (!moreOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [moreOpen]);

  const tabs: Array<{
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
    /** Highlight rule: pathname starts with one of these prefixes. */
    matchPrefixes: string[];
  }> = [
    {
      href: "/dashboard",
      label: labels.home,
      Icon: LayoutGrid,
      matchPrefixes: ["/dashboard"],
    },
    {
      href: "/calendar",
      label: labels.calendar,
      Icon: CalendarDays,
      matchPrefixes: ["/calendar"],
    },
    {
      href: "/orders",
      label: labels.orders,
      Icon: ListChecks,
      // Orders + CSV imports both feel like "orders work", group them.
      matchPrefixes: ["/orders", "/imports"],
    },
    {
      href: "/vehicles",
      label: labels.fleet,
      Icon: Car,
      // The 'Fleet' tab covers vehicles, ROI, and owners — they're all
      // about the cars and the people who own them.
      matchPrefixes: ["/vehicles", "/vehicle-roi", "/owners"],
    },
  ];

  const isMoreActive = !tabs.some((tab) =>
    tab.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
  );

  return (
    <>
      {/* Bar itself — fixed to the bottom, full width, sits above
          everything except modals. The `pb-safe` adds the iOS home
          indicator inset so the touch targets never get clipped. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)]/95 pb-safe backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {tabs.map((tab) => {
            const active = tab.matchPrefixes.some((prefix) =>
              pathname.startsWith(prefix),
            );
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "tap-press flex flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium",
                  active
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                <tab.Icon
                  className={cn(
                    "h-[22px] w-[22px]",
                    active ? "stroke-[2.4]" : "stroke-[1.8]",
                  )}
                />
                <span className="leading-none">{tab.label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              "tap-press flex flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium",
              isMoreActive || moreOpen
                ? "text-[var(--ink)]"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
            )}
          >
            <MoreHorizontal
              className={cn(
                "h-[22px] w-[22px]",
                isMoreActive || moreOpen ? "stroke-[2.4]" : "stroke-[1.8]",
              )}
            />
            <span className="leading-none">{labels.more}</span>
          </button>
        </div>
      </nav>

      {/* "More" bottom sheet. Slides up from the bar and lists every
          remaining destination. Tapping outside or on a row closes it
          (rows close via the route-change effect; the backdrop has
          its own onClick). */}
      {moreOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labels.moreTitle}
          className="fixed inset-0 z-40 lg:hidden"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-[1.4rem] bg-[var(--surface)] pb-safe shadow-[0_-30px_80px_rgba(0,0,0,0.25)]">
            {/* Drag handle, purely cosmetic but signals "swipeable
                sheet" the way native iOS does. */}
            <div className="flex justify-center pt-2.5">
              <span className="h-1 w-10 rounded-full bg-[var(--ink-soft)]/30" />
            </div>

            <div className="flex items-center justify-between px-5 pb-3 pt-3">
              <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                {labels.moreTitle}
              </h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="tap-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ul className="grid gap-1 px-3 pb-2">
              {moreItems.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "tap-press flex items-center justify-between rounded-xl px-4 py-3.5 text-[15px] font-medium",
                        active
                          ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                          : "bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                      )}
                    >
                      <span>{item.label}</span>
                      <span
                        aria-hidden
                        className="text-[var(--ink-soft)]"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {moreFooter ? (
              <div className="border-t border-[var(--line)] px-4 pt-4 pb-4">
                {moreFooter}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
