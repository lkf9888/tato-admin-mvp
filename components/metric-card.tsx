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
    <div className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_50px_rgba(17,19,24,0.05)]">
      <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--ink-soft)]">{label}</p>
      <p className="mt-4 font-serif text-[2.7rem] leading-none text-[var(--ink)]">{value}</p>
      <p className="mt-3 max-w-[16rem] text-[13px] leading-5 text-[var(--ink-soft)]">{hint}</p>
    </div>
  );
}
