import { RentalEstimateTool } from "@/components/rental-estimate-tool";
import { getLocaleTag } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { FIT_SUMMARY } from "@/lib/rental-estimate";

/**
 * What a given car would earn if we listed it — a desk tool for
 * answering an owner who asks, rather than a page we point them at.
 *
 * Nothing here touches the database: the estimate is computed in the
 * browser from `lib/rental-estimate`, so the page has no queries to wait
 * on and no workspace to scope to.
 */
export default async function RentalEstimatePage() {
  const { locale, messages } = await getI18n();
  const copy = messages.rentalEstimate;

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
          {copy.kicker}
        </p>
        <h2 className="mt-1 font-serif text-[1.25rem] leading-tight text-[color:var(--ink)] sm:text-[1.45rem]">
          {copy.title}
        </h2>
        <p className="mt-2 max-w-4xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
          {copy.intro}
        </p>
        <p className="mt-2.5 inline-block rounded-[var(--radius-pill)] bg-[var(--brand-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--brand)] tabular-nums">
          {copy.statsBadge
            .replace("{trips}", FIT_SUMMARY.trips.toLocaleString(getLocaleTag(locale)))
            .replace("{vehicles}", String(FIT_SUMMARY.vehicles))
            .replace("{from}", FIT_SUMMARY.from)
            .replace("{to}", FIT_SUMMARY.to)}
        </p>
      </section>

      <RentalEstimateTool locale={locale} copy={copy} />
    </div>
  );
}
