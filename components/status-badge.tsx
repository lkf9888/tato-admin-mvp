import { cn } from "@/lib/utils";
import { getStatusLabel, type Locale } from "@/lib/i18n";

const badgeStyles: Record<string, string> = {
  turo: "border border-slate-900/10 bg-slate-900 text-white",
  offline: "border border-emerald-900/10 bg-emerald-50 text-emerald-900",
  cancelled: "border border-slate-900/8 bg-slate-200 text-slate-700",
  booked: "border border-[rgba(89,60,251,0.18)] bg-[var(--accent-soft)] text-[var(--ink)]",
  ongoing: "border border-emerald-900/10 bg-[#dceee5] text-[#184b39]",
  completed: "border border-slate-900/8 bg-[#f3ede2] text-slate-700",
  available: "border border-emerald-900/10 bg-emerald-50 text-emerald-900",
  maintenance: "border border-amber-900/10 bg-amber-100 text-amber-900",
  inactive: "border border-slate-900/8 bg-slate-200 text-slate-700",
  conflict: "border border-rose-900/12 bg-rose-100 text-rose-800",
  standard: "border border-slate-900/8 bg-white text-slate-800",
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
        badgeStyles[value] ?? "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {getStatusLabel(value, locale)}
    </span>
  );
}
