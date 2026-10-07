"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A thin bar along the top of a rental site while the next page loads.
 *
 * Links between a site's pages are client-side navigations, so the
 * browser shows no loading of its own: on a slow phone connection a tap
 * on a car looked like nothing had happened, and the renter tapped again
 * or reloaded. The bar appears on a tap of an internal link and goes when
 * the new address arrives. The admin has its own, watching every request;
 * the public pages sit outside that shell.
 */
export function SiteRouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("a");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      // Same page, another anchor: nothing to load.
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      setLoading(true);
    }
    // Capture, not bubble: Next's <Link> cancels the click to navigate on
    // its own, so by the time it bubbles here it reads as prevented.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!loading) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-[var(--brand)]/20">
      <div className="h-full w-1/3 bg-[var(--brand)] motion-safe:animate-[tato-route-progress_1.1s_ease-in-out_infinite]" />
    </div>
  );
}
