"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The three views of /vehicle-roi.
 *
 * Real routes rather than client-side tabs: each view is its own URL, so
 * a bookmark, a shared link or the back button lands on the same tab,
 * and the fleet view's database query only runs when the fleet view is
 * the one being looked at.
 */
export function VehicleRoiTabs({
  labels,
}: {
  labels: { fleet: string; estimate: string; ranking: string };
}) {
  const pathname = usePathname();
  const tabs = [
    { href: "/vehicle-roi", label: labels.fleet },
    { href: "/vehicle-roi/estimate", label: labels.estimate },
    { href: "/vehicle-roi/ranking", label: labels.ranking },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label={labels.fleet}>
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-[var(--ink)] text-white"
                : "text-[var(--ink-mid)] hover:bg-[var(--accent-soft-strong)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
