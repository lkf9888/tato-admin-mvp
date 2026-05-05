/**
 * One stat card on the dashboard. Sized for high information density —
 * v0.20.2 tightened padding and font sizes one tier vs. v0.18.1 so all
 * five strip cards plus the day panels and activity log fit on one
 * screen without scrolling. Two visual targets:
 *  - Mobile (< sm): horizontal snap-scroll strip, ~52% viewport-wide
 *    card. Value at 1.5rem stays glanceable, label and hint shrink to
 *    11px so there's room for label + number + 2-line hint without
 *    overflowing the row height of the metrics above the day panels.
 *  - Desktop (≥ sm): grid layout, 2rem value (was 2.7rem). Same hint
 *    tier — a touch smaller than the previous design but still
 *    readable at the 220-260px column width.
 */
export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="h-full snap-start rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_20px_50px_rgba(17,19,24,0.05)] sm:p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)] sm:text-[11px] sm:tracking-[0.26em]">
        {label}
      </p>
      <p className="mt-1 font-serif text-[1.35rem] leading-none text-[var(--ink)] sm:mt-1.5 sm:text-[1.7rem]">
        {value}
      </p>
      <p className="mt-1.5 line-clamp-2 max-w-[16rem] text-[11px] leading-snug text-[var(--ink-soft)] sm:mt-2 sm:text-[12px]">
        {hint}
      </p>
    </div>
  );
}
