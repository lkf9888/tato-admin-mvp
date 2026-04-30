/**
 * One stat card on the dashboard. Two visual targets:
 *  - Desktop / tablet (default): the full pillar card with a 2.7rem
 *    serif value and a 16rem-wide hint paragraph. Reads well in a
 *    grid where each card has ~220px of width.
 *  - Mobile (< sm): the same card content has to fit in a horizontal
 *    snap-scroll strip, so we drop padding and the hint shrinks to a
 *    one-liner. The number stays loud (still 2rem) since glanceability
 *    is the whole point of a metric card.
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
    <div className="h-full snap-start rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_20px_50px_rgba(17,19,24,0.05)] sm:p-5">
      <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--ink-soft)] sm:text-[11px] sm:tracking-[0.28em]">
        {label}
      </p>
      <p className="mt-3 font-serif text-[2rem] leading-none text-[var(--ink)] sm:mt-4 sm:text-[2.7rem]">
        {value}
      </p>
      <p className="mt-2 line-clamp-2 max-w-[16rem] text-[12px] leading-5 text-[var(--ink-soft)] sm:mt-3 sm:line-clamp-none sm:text-[13px]">
        {hint}
      </p>
    </div>
  );
}
