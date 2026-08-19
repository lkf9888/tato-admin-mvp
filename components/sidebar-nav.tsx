"use client";

import { NAV_ICONS, type NavIconName } from "@/components/nav-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: NavIconName };
type NavGroup = { label: string; items: NavItem[] };

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((group) => (
        <section key={group.label} className="space-y-1.5">
          <div className="px-3 text-[11px] font-semibold text-[var(--ink-soft)]">
            {group.label}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              const Icon = NAV_ICONS[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "tap-press flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors active:scale-[0.98]",
                    // Tinted, not inverted. Turo marks the current
                    // section with its purple on a pale ground; a solid
                    // black bar reads as a pressed button and fights
                    // the flat cards next to it.
                    active
                      ? "bg-[var(--brand-soft)] font-bold text-[var(--brand)]"
                      : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]",
                  )}
                >
                  <Icon
                    className={cn("size-[18px] shrink-0", active ? "opacity-100" : "opacity-60")}
                    strokeWidth={active ? 2.25 : 1.75}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
