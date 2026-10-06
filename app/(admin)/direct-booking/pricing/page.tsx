import { DirectBookingSubpageFrame } from "@/components/direct-booking-subpage-frame";
import { DynamicPricingPanel } from "@/components/dynamic-pricing-panel";
import { requireCurrentWorkspace } from "@/lib/auth";
import { dateToDateOnly } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";
import { excludedIds, getDynamicPricingSettings, knobsFrom } from "@/lib/vehicle-pricing-dynamic-run";

/** Dynamic pricing: its settings, and the suggestions waiting to be applied. */
export default async function DynamicPricingPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, settings, vehicles, suggestions] = await Promise.all([
    getI18n(),
    getDynamicPricingSettings(workspace.id),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, isArchived: false, directBookingEnabled: true },
      select: { id: true, plateNumber: true, brand: true, model: true, year: true, nickname: true },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
    }),
    prisma.dynamicPriceSuggestion.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ vehicleId: "asc" }, { date: "asc" }],
    }),
  ]);
  const excluded = excludedIds(settings);
  const knobs = knobsFrom(settings);

  return (
    <div className="space-y-3">
      <DirectBookingSubpageFrame workspaceId={workspace.id} locale={locale} active="pricing" />
      <DynamicPricingPanel
        locale={locale}
        settings={{
          enabled: settings.enabled,
          autoApply: settings.autoApply,
          horizonDays: knobs.horizonDays,
          minPct: knobs.minPct,
          maxPct: knobs.maxPct,
          maxDailyChangePct: knobs.maxDailyChangePct,
          weekendPct: knobs.weekendPct,
          holidayPct: knobs.holidayPct,
          lastMinuteDays: knobs.lastMinuteDays,
          lastMinutePct: knobs.lastMinutePct,
          farOutDays: knobs.farOutDays,
          farOutPct: knobs.farOutPct,
          targetOccupancy: knobs.targetOccupancy,
          occupancyStrength: knobs.occupancyStrength,
          gapMaxDays: knobs.gapMaxDays,
          gapPct: knobs.gapPct,
          events: knobs.events,
          excludedVehicleIds: [...excluded],
        }}
        lastRun={settings.lastRunAt ? formatDateTime(settings.lastRunAt, locale) : null}
        vehicles={vehicles.map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.plateNumber} · ${vehicle.nickname?.trim() || `${vehicle.year} ${vehicle.brand} ${vehicle.model}`}`,
        }))}
        suggestions={suggestions.map((suggestion) => ({
          vehicleId: suggestion.vehicleId,
          day: dateToDateOnly(suggestion.date),
          current: suggestion.current,
          suggested: suggestion.suggested,
          factors: JSON.parse(suggestion.factors),
        }))}
      />
    </div>
  );
}
