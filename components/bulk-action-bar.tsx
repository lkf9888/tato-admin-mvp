"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The bar that appears when rows are picked: how many, what can be done
 * to them, and the way out. Fixed to the bottom of the screen -- above
 * the phone's tab bar, and its home indicator -- so the actions stay in
 * reach however far down the list the last pick was.
 */
export function BulkActionBar({
  count,
  countLabel,
  clearLabel,
  onClear,
  children,
}: {
  count: number;
  countLabel: string;
  clearLabel: string;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={countLabel}
      className="tato-sheet-up fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-30 flex justify-center px-3 lg:bottom-4 lg:pl-56"
    >
      <div className="flex max-w-full flex-wrap items-center gap-2 rounded-xl bg-[var(--ink)] px-3 py-2 text-white shadow-[0_18px_40px_-12px_rgba(17,19,24,0.55)]">
        <span className="px-1 text-[12.5px] font-semibold tabular-nums">{countLabel}</span>
        <span aria-hidden className="h-5 w-px bg-white/20" />
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className="tap-compact ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** One action on the bar. `tone="danger"` for the destructive one. */
export function BulkActionButton({
  onClick,
  disabled,
  tone = "default",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center rounded-md px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary" && "bg-white text-[var(--ink)] hover:bg-white/90",
        tone === "default" && "bg-white/10 text-white hover:bg-white/20",
        tone === "danger" && "bg-rose-500/90 text-white hover:bg-rose-500",
      )}
    >
      {children}
    </button>
  );
}
