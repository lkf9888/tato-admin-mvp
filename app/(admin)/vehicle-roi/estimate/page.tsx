import { RentalEstimateTool } from "@/components/rental-estimate-tool";
import { getLocaleTag } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { FIT_SUMMARY } from "@/lib/rental-estimate";

/**
 * What a given car would earn if we listed it — a desk tool for
 * answering an owner who asks.
 *
 * Nothing here touches the database: the estimate is computed in the
 * browser from `lib/rental-estimate`, so the view has no queries to wait
 * on and no workspace to scope to.
 */
export default async function VehicleRoiEstimatePage() {
  const { locale, messages } = await getI18n();
  const copy = messages.rentalEstimate;

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-5 text-[var(--ink-soft)]">
        <span>{messages.valuation.introEstimate}</span>
        <span className="rounded-[var(--radius-pill)] bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand)] tabular-nums">
          {copy.statsBadge
            .replace("{trips}", FIT_SUMMARY.trips.toLocaleString(getLocaleTag(locale)))
            .replace("{vehicles}", String(FIT_SUMMARY.vehicles))
            .replace("{from}", FIT_SUMMARY.from)
            .replace("{to}", FIT_SUMMARY.to)}
        </span>
      </p>

      <RentalEstimateTool locale={locale} copy={copy} />
    </div>
  );
}
