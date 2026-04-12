import { BillingManagerPanel } from "@/components/billing-manager-panel";
import { getWorkspaceBillingSnapshot } from "@/lib/billing";
import { getI18n } from "@/lib/i18n-server";
import { formatDateTime } from "@/lib/utils";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    billing?: string;
    required?: string;
    projected?: string;
    needed?: string;
  }>;
}) {
  const [{ locale }, billingSnapshot, params] = await Promise.all([
    getI18n(),
    getWorkspaceBillingSnapshot(),
    searchParams,
  ]);

  const requestedRequiredSlots = Number.parseInt(params.required ?? "", 10);
  const projectedVehicleCount = Number.parseInt(params.projected ?? "", 10);
  const additionalPaidSlotsNeeded = Number.parseInt(params.needed ?? "", 10);
  const initialDesiredPaidVehicleSlots = Math.max(
    1,
    Number.isFinite(requestedRequiredSlots)
      ? requestedRequiredSlots
      : billingSnapshot.requiredPaidSlots || billingSnapshot.effectivePurchasedVehicleSlots || 1,
  );

  return (
    <BillingManagerPanel
      locale={locale}
      initialSnapshot={{
        currentVehicleCount: billingSnapshot.currentVehicleCount,
        freeVehicleSlots: billingSnapshot.freeVehicleSlots,
        bonusVehicleSlots: billingSnapshot.bonusVehicleSlots,
        purchasedVehicleSlots: billingSnapshot.purchasedVehicleSlots,
        effectivePurchasedVehicleSlots: billingSnapshot.effectivePurchasedVehicleSlots,
        allowedVehicleCount: billingSnapshot.allowedVehicleCount,
        requiredPaidSlots: billingSnapshot.requiredPaidSlots,
        isOverLimit: billingSnapshot.isOverLimit,
        stripeConfigured: billingSnapshot.stripeConfigured,
        status: billingSnapshot.status,
        currentPeriodEnd: billingSnapshot.currentPeriodEnd?.toISOString() ?? null,
      }}
      billingState={params.billing ?? null}
      initialDesiredPaidVehicleSlots={initialDesiredPaidVehicleSlots}
      projectedVehicleCount={Number.isFinite(projectedVehicleCount) ? projectedVehicleCount : null}
      additionalPaidSlotsNeeded={
        Number.isFinite(additionalPaidSlotsNeeded) ? additionalPaidSlotsNeeded : null
      }
      currentPeriodEndLabel={
        billingSnapshot.currentPeriodEnd ? formatDateTime(billingSnapshot.currentPeriodEnd, locale) : null
      }
    />
  );
}
