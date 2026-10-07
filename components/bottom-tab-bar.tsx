"use client";

import { CloseButton } from "@/components/back-button";
import { CountPill, NavBadge, useNavBadges } from "@/components/nav-badges";
import { NAV_ICONS, type NavIconName } from "@/components/nav-icons";
import {
  CalendarDays,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

type SidebarItem = { href: string; label: string; icon?: NavIconName };
type SidebarGroup = { label: string; items: SidebarItem[] };

/** How far the sheet must be pulled down, in px, to close on release. */
const DISMISS_DRAG = 80;

export function BottomTabBar({
  labels,
  moreItems,
  moreGroups,
  moreFooter,
}: {
  labels: {
    home: string;
    calendar: string;
    orders: string;
    schedule: string;
    fleet: string;
    more: string;
    moreTitle: string;
  };
  // The 'More' sheet renders every nav row that didn't fit in the four
  // tabs. Passed down from AppShell so the source of truth for the
  // total nav stays in one place.
  moreItems: SidebarItem[];
  /** The same items under the sidebar's group headings, for the sheet. */
  moreGroups?: SidebarGroup[];
  // Slot at the bottom of the More sheet for non-nav controls
  // (language switcher, sign-out, version chip, etc.) so the mobile
  // shell exposes everything the desktop sidebar does without needing
  // a second drawer.
  moreFooter?: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
      setDragY(0);
    };
  }, [moreOpen]);

  // Pull the sheet down by its handle to close it, as on iOS. Only the
  // handle and title row drag: the list below scrolls.
  const dragHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      dragStart.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (dragStart.current === null) return;
      setDragY(Math.max(0, event.clientY - dragStart.current));
    },
    onPointerUp: () => {
      if (dragStart.current === null) return;
      dragStart.current = null;
      if (dragY > DISMISS_DRAG) setMoreOpen(false);
      else setDragY(0);
    },
    onPointerCancel: () => {
      dragStart.current = null;
      setDragY(0);
    },
  };

  const groups: SidebarGroup[] = moreGroups ?? [{ label: "", items: moreItems }];

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
      href: "/staff-schedule",
      label: labels.schedule,
      Icon: UsersRound,
      matchPrefixes: ["/staff-schedule"],
    },
  ];

  // A team member's navigation is already cut to their pages; the fixed
  // tabs follow it rather than leading to a page they cannot open.
  const visibleTabs = tabs.filter((tab) => moreItems.some((item) => item.href === tab.href));

  const isMoreActive = !visibleTabs.some((tab) =>
    tab.matchPrefixes.some((prefix) => pathname.startsWith(prefix)),
  );

  // What is waiting behind "More": the counts of every destination that
  // has no tab of its own, so a reply to answer is visible from the bar.
  const badges = useNavBadges();
  const moreCount = moreItems
    .filter((item) => !visibleTabs.some((tab) => tab.href === item.href))
    .reduce((sum, item) => sum + (badges[item.href] ?? 0), 0);

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
          {visibleTabs.map((tab) => {
            const active = tab.matchPrefixes.some((prefix) =>
              pathname.startsWith(prefix),
            );
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "tap-press flex flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium",
                  active
                    ? "text-[var(--ink)]"
                    : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                <span className="relative">
                  <tab.Icon
                    className={cn(
                      "h-[22px] w-[22px]",
                      active ? "stroke-[2.4]" : "stroke-[1.8]",
                    )}
                  />
                  <NavBadge href={tab.href} className="absolute -right-2.5 -top-1.5" />
                </span>
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
            <span className="relative">
              <MoreHorizontal
                className={cn(
                  "h-[22px] w-[22px]",
                  isMoreActive || moreOpen ? "stroke-[2.4]" : "stroke-[1.8]",
                )}
              />
              <CountPill count={moreCount} className="absolute -right-2.5 -top-1.5" />
            </span>
            <span className="leading-none">{labels.more}</span>
          </button>
        </div>
      </nav>

      {/* "More" sheet, rising from the bottom where the thumb already
          is. Tapping outside, pressing Escape or pulling it down closes
          it; rows close it through the route-change effect. */}
      {moreOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={labels.moreTitle}
          className="fixed inset-0 z-40 flex items-end justify-center lg:hidden"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="tato-fade-in absolute inset-0 bg-black/40"
          />
          <div
            className="tato-sheet-up relative flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-2xl bg-[var(--surface)] pb-safe shadow-[0_-20px_60px_rgba(0,0,0,0.22)]"
            style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
          >
            <div {...dragHandlers} className="shrink-0 cursor-grab touch-none select-none px-4 pt-2 pb-2">
              <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-[var(--line-strong)]" />
              <div className="mt-2 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-[var(--ink)]">{labels.moreTitle}</h2>
                <span onPointerDown={(event) => event.stopPropagation()}>
                  <CloseButton onClick={() => setMoreOpen(false)} label="Close menu" />
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
              {groups.map((group) => (
                <section key={group.label || "all"} className="pt-2">
                  {group.label ? (
                    <h3 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                      {group.label}
                    </h3>
                  ) : null}
                  {/* Two columns of tiles: the whole site map fits on
                      one screen of a phone instead of a long list. */}
                  <ul className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      const Icon = item.icon ? NAV_ICONS[item.icon] : null;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            prefetch
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "tap-press flex min-h-[52px] items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] font-medium",
                              active
                                ? "bg-[var(--brand-soft)] font-semibold text-[var(--brand)]"
                                : "bg-[var(--surface-muted)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                            )}
                          >
                            {Icon ? <Icon className="size-[18px] shrink-0 opacity-70" strokeWidth={1.75} aria-hidden /> : null}
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            <NavBadge href={item.href} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              {moreFooter ? <div className="mt-4 border-t border-[var(--line)] px-1 pt-4">{moreFooter}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
