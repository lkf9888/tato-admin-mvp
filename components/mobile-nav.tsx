"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Mobile-only top bar + slide-in drawer wrapper for the admin shell.
 * Server-rendered sidebar content is passed in as children — the drawer
 * just toggles visibility and overlays the page when open. Closes itself
 * on route change.
 */
export function MobileNav({
  brandTitle,
  brandKicker,
  children,
}: {
  brandTitle: string;
  brandKicker: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer whenever the URL changes (after a nav click).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll while drawer is open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur lg:hidden">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
            {brandKicker}
          </p>
          <p className="font-serif text-xl font-semibold leading-none text-[var(--ink)]">
            {brandTitle}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <aside
            className={cn(
              "absolute inset-y-0 left-0 flex w-[min(20rem,90vw)] flex-col overflow-y-auto bg-[var(--panel-strong)] px-5 py-5 shadow-[0_30px_80px_rgba(0,0,0,0.25)]",
            )}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.42em] text-[var(--ink-soft)]">
                {brandKicker}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </aside>
        </div>
      ) : null}
    </>
  );
}
