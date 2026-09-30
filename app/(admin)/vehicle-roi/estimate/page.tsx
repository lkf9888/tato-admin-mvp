import { RentalEstimateTool } from "@/components/rental-estimate-tool";
import { getI18n } from "@/lib/i18n-server";

/**
 * What a given car would earn if we listed it — a desk tool for
 * answering an owner who asks.
 *
 * Nothing here touches the database: the estimate is computed in the
 * browser from `lib/rental-estimate`, so the view has no queries to wait
 * on and no workspace to scope to. The data basis it used to announce
 * up top (trips, cars, date range) lives in the tool's method section.
 */
export default async function VehicleRoiEstimatePage() {
  const { locale, messages } = await getI18n();
  return <RentalEstimateTool locale={locale} copy={messages.rentalEstimate} />;
}
