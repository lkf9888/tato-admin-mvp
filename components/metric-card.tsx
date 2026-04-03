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
    <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-4 font-serif text-4xl text-slate-950">{value}</p>
      <p className="mt-3 text-sm text-slate-600">{hint}</p>
    </div>
  );
}
