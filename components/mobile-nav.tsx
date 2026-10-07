"use client";

import { usePathname } from "next/navigation";

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
 * Mobile-only top bar for the admin shell. Navigation itself lives in
 * `BottomTabBar` (bottom tabs + More sheet); this bar says where you are:
 * the brand small, the current page's name under it, so a page reached
 * from the More sheet is not left unnamed until its own heading scrolls in.
 */
export function MobileNav({ brandTitle, items }: { brandTitle: string; items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const page = currentItem(pathname, items);
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 pt-safe pb-2.5 backdrop-blur lg:hidden">
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-[0.28em] text-[var(--ink-soft)]">{brandTitle}</p>
        <p className="mt-0.5 truncate text-[15px] font-semibold leading-tight text-[var(--ink)]">
          {page?.label ?? brandTitle}
        </p>
      </div>
    </header>
  );
}
