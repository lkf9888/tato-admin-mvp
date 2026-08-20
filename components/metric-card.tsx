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
  compactValue,
  hint,
}: {
  label: string;
  value: string;
  /**
   * A shorter rendering of the same number, used below `sm`. Falls
   * back to `value` when the two are the same thing.
   */
  compactValue?: string;
  hint: string;
}) {
  const phoneValue = compactValue ?? value;

  // Four cards across a 375px screen leaves each number about 66px.
  // A value with no space in it -- a currency amount, most of all --
  // cannot wrap, so anything too wide is clipped mid-digit rather
  // than pushed to a second line. Stepping the size down by length
  // keeps the short values big and the long ones whole.
  //
  // The rungs are measured, not guessed: `CA$74,629.75` rendered 111px
  // wide at 17px on the live dashboard, so a digit costs about 9.25px
  // at that size, and each rung is the largest size whose worst-case
  // string still lands under 66px. Seven-figure months hit the last
  // rung and stay legible.
  const phoneValueSize =
    phoneValue.length >= 12
      ? "text-[10px]"
      : phoneValue.length >= 9
        ? "text-[12px]"
        : phoneValue.length >= 7
          ? "text-[14px]"
          : "text-[17px]";

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
      <p
        className={`mt-0.5 font-black leading-none tracking-[-0.02em] text-[var(--ink)] ${phoneValueSize} sm:mt-1.5 sm:font-serif sm:text-[1.7rem] sm:tracking-normal`}
      >
        <span className="sm:hidden">{phoneValue}</span>
        <span className="hidden sm:inline">{value}</span>
      </p>
      {/* The explanation is the first thing to go when space is short:
          it explains a number that is already labelled. */}
      <p className="mt-1.5 line-clamp-2 hidden max-w-[16rem] text-[11px] leading-snug text-[var(--ink-soft)] sm:mt-2 sm:block sm:text-[12px]">
        {hint}
      </p>
    </div>
  );
}
