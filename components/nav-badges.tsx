"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * How many things each part of the app is waiting on, shown as a number
 * on its navigation entry -- sidebar, bottom tabs and the More sheet.
 *
 * One request for all of them (`/api/messages/counts`), every minute
 * while the page is visible and once more when the app comes back to
 * the foreground. Not on navigation: the provider lives in the admin
 * shell, which stays mounted from page to page, so the numbers carry
 * over instead of blanking and refetching. The endpoint reads a few
 * hundred emails to group conversations, which is fine once a minute
 * and wasteful on every click.
 */

type Counts = { needsReply: number; pendingOrders: number; scheduledDue: number };

const POLL_INTERVAL_MS = 60_000;
/** Coming back to the app refreshes, but not twice in quick succession. */
const MIN_REFRESH_GAP_MS = 15_000;

const NavBadgeContext = createContext<Record<string, number>>({});

/** Which destination each count belongs to. */
function badgesFrom(counts: Counts | null): Record<string, number> {
  if (!counts) return {};
  return {
    // Conversations to answer, plus scheduled messages due to go out:
    // both are a person's job on the messages page.
    "/messages": counts.needsReply + counts.scheduledDue,
    "/orders": counts.pendingOrders,
  };
}

function toCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function NavBadgeProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const inFlight = useRef(false);
  const lastFetched = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    if (!force && Date.now() - lastFetched.current < MIN_REFRESH_GAP_MS) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/messages/counts", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      lastFetched.current = Date.now();
      setCounts({
        needsReply: toCount(data?.needsReply),
        pendingOrders: toCount(data?.pendingOrders),
        scheduledDue: toCount(data?.scheduledDue),
      });
    } catch {
      // Offline or signed out: keep the last numbers rather than flash zero.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    const onForeground = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onForeground);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [refresh]);

  const badges = useMemo(() => badgesFrom(counts), [counts]);
  return <NavBadgeContext.Provider value={badges}>{children}</NavBadgeContext.Provider>;
}

export function useNavBadges() {
  return useContext(NavBadgeContext);
}

/** The count for one destination, as a small red pill; nothing at zero. */
export function NavBadge({ href, className }: { href: string; className?: string }) {
  const count = useNavBadges()[href] ?? 0;
  return <CountPill count={count} className={className} />;
}

export function CountPill({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
