import { cn } from "@/lib/utils";
import { getStatusLabel, type Locale } from "@/lib/i18n";

const badgeStyles: Record<string, string> = {
  turo: "border border-[var(--ink)]/10 bg-[var(--ink)] text-white",
  offline: "border border-emerald-900/10 bg-emerald-50 text-emerald-900",
  cancelled: "border border-[var(--ink)]/8 bg-[var(--accent-soft-strong)] text-[var(--ink-mid)]",
  booked: "border border-[rgba(89,60,251,0.18)] bg-[var(--accent-soft)] text-[var(--ink)]",
  ongoing: "border border-emerald-900/10 bg-[#dceee5] text-[#184b39]",
  completed: "border border-[var(--ink)]/8 bg-[#f3ede2] text-[var(--ink-mid)]",
  available: "border border-emerald-900/10 bg-emerald-50 text-emerald-900",
  maintenance: "border border-amber-900/10 bg-amber-100 text-amber-900",
  inactive: "border border-[var(--ink)]/8 bg-[var(--accent-soft-strong)] text-[var(--ink-mid)]",
  conflict: "border border-rose-900/12 bg-rose-100 text-rose-800",
  standard: "border border-[var(--ink)]/8 bg-white text-[var(--ink)]",
  privacy: "border border-[rgba(89,60,251,0.18)] bg-[var(--accent-soft)] text-[var(--ink)]",
};

export function StatusBadge({
  value,
  locale = "en",
  className,
}: {
  value: string;
  locale?: Locale;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize tracking-[0.06em]",
        badgeStyles[value] ?? "bg-[var(--surface-muted)] text-[var(--ink-mid)]",
        className,
      )}
    >
      {getStatusLabel(value, locale)}
    </span>
  );
}
