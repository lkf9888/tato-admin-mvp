import { cn } from "@/lib/utils";
import { getStatusLabel, type Locale } from "@/lib/i18n";

const badgeStyles: Record<string, string> = {
  turo: "bg-sky-100 text-sky-800",
  offline: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
  booked: "bg-amber-100 text-amber-800",
  ongoing: "bg-violet-100 text-violet-800",
  completed: "bg-slate-100 text-slate-600",
  available: "bg-emerald-100 text-emerald-800",
  maintenance: "bg-orange-100 text-orange-800",
  inactive: "bg-slate-200 text-slate-700",
  conflict: "bg-rose-100 text-rose-800",
  standard: "bg-sky-100 text-sky-700",
  privacy: "bg-fuchsia-100 text-fuchsia-700",
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
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize tracking-wide",
        badgeStyles[value] ?? "bg-slate-100 text-slate-700",
        className,
      )}
    >
      {getStatusLabel(value, locale)}
    </span>
  );
}
