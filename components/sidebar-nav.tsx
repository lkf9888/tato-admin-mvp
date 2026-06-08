"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: string };
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
          <div className="px-3 text-[11px] font-semibold text-neutral-400">
            {group.label}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "tap-press flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors active:scale-[0.98]",
                    active
                      ? "bg-neutral-900 text-white shadow-sm"
                      : "text-neutral-700 hover:bg-neutral-100",
                  )}
                >
                  <span
                    className={cn("w-5 shrink-0 text-center text-[15px]", active ? "opacity-100" : "opacity-70")}
                    aria-hidden
                  >
                    {item.icon}
                  </span>
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
