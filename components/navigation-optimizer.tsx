"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function NavigationOptimizer({ hrefs }: { hrefs: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  const uniqueHrefs = useMemo(
    () => Array.from(new Set(hrefs.filter((href) => href.startsWith("/")))),
    [hrefs],
  );

  useEffect(() => {
    let cancelled = false;
    const prefetchAll = () => {
      let index = 0;
      const tick = () => {
        if (cancelled || index >= uniqueHrefs.length) return;
        const href = uniqueHrefs[index];
        index += 1;
        if (href && href !== pathname) {
          router.prefetch(href);
        }
        window.setTimeout(tick, 120);
      };
      tick();
    };

    const idleHandle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(prefetchAll, { timeout: 1600 })
        : window.setTimeout(prefetchAll, 800);

    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [pathname, router, uniqueHrefs]);

  useEffect(() => {
    function internalHrefFromEvent(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return null;
      if (anchor.target && anchor.target !== "_self") return null;
      if (anchor.hasAttribute("download")) return null;

      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return null;
      }
      return `${url.pathname}${url.search}`;
    }

    function prefetchOnPointerDown(event: PointerEvent) {
      const href = internalHrefFromEvent(event);
      if (href) router.prefetch(href);
    }

    function showFeedbackOnClick(event: MouseEvent) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = internalHrefFromEvent(event);
      if (href) setPending(true);
    }

    document.addEventListener("pointerdown", prefetchOnPointerDown, true);
    document.addEventListener("click", showFeedbackOnClick, true);
    return () => {
      document.removeEventListener("pointerdown", prefetchOnPointerDown, true);
      document.removeEventListener("click", showFeedbackOnClick, true);
    };
  }, [router]);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => setPending(false), 5000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  if (!pending) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-1 bg-[var(--accent-soft-strong)]/70">
      <div className="h-full w-1/3 animate-[tato-route-progress_1.05s_ease-in-out_infinite] bg-[var(--ink)] shadow-[0_0_18px_rgba(17,17,17,0.35)]" />
    </div>
  );
}
