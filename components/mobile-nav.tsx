"use client";

import { usePathname } from "next/navigation";

import { useMobileHeader } from "@/components/mobile-chrome";
import { sectionForPath } from "@/lib/access";

type NavItem = { href: string; label: string };

/** The nav entry a path sits under: its own, or its section's (/booking-requests is under orders). */
function currentItem(path: string, items: NavItem[]) {
  let best: NavItem | null = null;
  for (const item of items) {
    const under = path === item.href || path.startsWith(`${item.href}/`);
    if (under && (!best || item.href.length > best.href.length)) best = item;
  }
  if (best) return best;
  const section = sectionForPath(path);
  return section ? items.find((item) => item.href === section.key) ?? null : null;
}

/**
 * The phone's top bar: 44px under the status bar, the page's name at
 * 17px on the left, and on the right whatever icon buttons the page puts
 * there through <MobilePageHeader> (search, filters, ⋯, ＋). Navigation
 * itself is the bottom tab bar's job. The brand line that used to sit
 * above the name is gone: on a phone every pixel of height is a row of
 * the calendar.
 */
export function MobileNav({ brandTitle, items }: { brandTitle: string; items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const page = currentItem(pathname, items);
  const header = useMobileHeader();
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/95 pt-safe backdrop-blur lg:hidden">
      <div className="flex h-11 items-center justify-between gap-2 pl-3.5 pr-1.5">
        <div className="flex min-w-0 flex-1 items-center">
          {header.title ?? (
            <p className="truncate text-[17px] font-semibold leading-tight text-[var(--ink)]">
              {page?.label ?? brandTitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">{header.actions}</div>
      </div>
    </header>
  );
}
