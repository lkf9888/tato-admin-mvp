import { ChevronLeft, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The way back to the page above, the same everywhere: a chevron and
 * where it leads, with a thumb-sized hit area that does not move the
 * text. It used to be a "←" typed into each page, in three styles.
 */
export function BackLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "tap-press -ml-1.5 inline-flex min-h-9 items-center gap-0.5 rounded-md py-1 pl-0.5 pr-2 text-[13px] font-medium text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
        className,
      )}
    >
      <ChevronLeft aria-hidden className="size-4 shrink-0" strokeWidth={2} />
      {label}
    </Link>
  );
}

/** Closes a sheet or dialog: a round X, the same in every one. */
export function CloseButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "tap-press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--ink)] transition hover:bg-[var(--accent-soft-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
        className,
      )}
    >
      <X aria-hidden className="h-4 w-4" />
    </button>
  );
}
