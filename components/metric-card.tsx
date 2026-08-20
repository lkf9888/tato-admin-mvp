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
    <div className="h-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 sm:p-4">
      {/* Four across on a phone, so the whole daily picture is one
          glance rather than a horizontal scroll that hides two of the
          five numbers off-screen. Tracking is dropped at this size:
          letter-spacing on a two-line Chinese label wastes the width
          the fourth column needs. */}
      <p className="text-[10px] leading-tight text-[var(--ink-soft)] sm:text-[11px] sm:uppercase sm:tracking-[0.26em]">
        {label}
      </p>
      <p className="mt-0.5 text-[17px] font-black leading-none tracking-[-0.02em] text-[var(--ink)] sm:mt-1.5 sm:font-serif sm:text-[1.7rem] sm:tracking-normal">
        {value}
      </p>
      {/* The explanation is the first thing to go when space is short:
          it explains a number that is already labelled. */}
      <p className="mt-1.5 line-clamp-2 hidden max-w-[16rem] text-[11px] leading-snug text-[var(--ink-soft)] sm:mt-2 sm:block sm:text-[12px]">
        {hint}
      </p>
    </div>
  );
}
