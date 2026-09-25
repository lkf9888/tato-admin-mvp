import { headers } from "next/headers";

import { saveBookingPolicyAction } from "@/app/actions";
import { listBookingLocations } from "@/lib/booking-locations";
import { getRateSeasonality } from "@/lib/rental-estimate/rate-seasonality-server";
import { normalizeBookingPolicy } from "@/lib/booking-policy";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { formatCurrency } from "@/lib/utils";
import { BookingLocationsEditor } from "@/components/booking-locations-editor";
import {
  DirectBookingFleetTable,
  type FleetDefaults,
  type FleetRow,
} from "@/components/direct-booking-fleet-table";
import { DirectBookingEmailEditor } from "@/components/direct-booking-email-editor";
import { normalizeDirectBookingEmailTemplate } from "@/lib/direct-booking-email-template";
import { isEmailConfigured } from "@/lib/email";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getBlockedBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeSecretKey } from "@/lib/stripe";
import { formatDate } from "@/lib/utils";
import { isImageAttachment } from "@/lib/uploads";

export default async function DirectBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ emailSaved?: string; policySaved?: string; locationsSaved?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const bookableFrom = new Date();
  bookableFrom.setDate(bookableFrom.getDate() - 1);
  const [
    query,
    headerStore,
    { locale, messages },
    emailTemplate,
    savedPolicy,
    bookingLocations,
    seasonality,
    vehicles,
  ] = await Promise.all([
    searchParams,
    headers(),
    getI18n(),
    prisma.directBookingEmailTemplate.findUnique({ where: { workspaceId: workspace.id } }),
    prisma.bookingPricingPolicy.findUnique({ where: { workspaceId: workspace.id } }),
    listBookingLocations(workspace.id),
    getRateSeasonality(workspace.id),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: {
        owner: true,
        orders: {
          where: {
            isArchived: false,
            status: {
              not: "cancelled",
            },
            // Only trips that can still block a booking. This page
            // feeds `getBlockedBookingWindows`, which asks "when is
            // this car unavailable" -- a question about now and
            // ahead. It was loading every trip since 2016 to answer
            // it, which is where 1.6 MB of this page came from.
            // A day of slack on the near side keeps a trip that ends
            // today from disappearing mid-afternoon.
            returnDatetime: { gte: bookableFrom },
          },
          orderBy: {
            pickupDatetime: "asc",
          },
        },
      },
      orderBy: { plateNumber: "asc" },
    }),
  ]);
  // One light query for every photo's id, oldest first: the first per
  // car is its thumbnail -- the same photo the rental site uses as the
  // cover -- and the rest only count. Selecting ids alone keeps this
  // small even with eight photos on each of a hundred cars.
  const photoRows = await prisma.orderAttachment.findMany({
    where: {
      workspaceId: workspace.id,
      isArchived: false,
      kind: "photo",
      vehicleId: { in: vehicles.map((vehicle) => vehicle.id) },
    },
    orderBy: { uploadedAt: "asc" },
    select: { id: true, vehicleId: true, contentType: true, filename: true },
  });
  const photoCounts = new Map<string, number>();
  const firstPhotoIds = new Map<string, string>();
  for (const photo of photoRows) {
    if (!photo.vehicleId || !isImageAttachment(photo.contentType, photo.filename)) continue;
    photoCounts.set(photo.vehicleId, (photoCounts.get(photo.vehicleId) ?? 0) + 1);
    if (!firstPhotoIds.has(photo.vehicleId)) firstPhotoIds.set(photo.vehicleId, photo.id);
  }

  const directMessages = messages.directBookingPage;
  const fleetPolicy = normalizeBookingPolicy(savedPolicy);
  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const protocol =
    forwardedProto ??
    (forwardedHost?.includes("localhost") || forwardedHost?.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const requestOrigin = forwardedHost ? `${protocol}://${forwardedHost}` : undefined;
  const appUrl = requestOrigin?.replace(/\/$/, "") ?? getAppUrl();
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.isArchived);
  const enabledCount = activeVehicles.filter((vehicle) => vehicle.directBookingEnabled).length;
  const rates = new Map(
    vehicles.map((vehicle) => [vehicle.id, resolveVehicleDailyRate(vehicle, fleetPolicy)]),
  );
  const readyCount = activeVehicles.filter(
    (vehicle) => vehicle.directBookingEnabled && (rates.get(vehicle.id)?.dailyRate ?? 0) > 0,
  ).length;

  const fleetDefaults: FleetDefaults = {
    insurance: fleetPolicy.insuranceFee,
    deposit: fleetPolicy.depositAmount,
    taxName: fleetPolicy.taxName,
    taxRate: fleetPolicy.taxRate,
    weekly: fleetPolicy.weeklyDiscountPercent,
    minDays: fleetPolicy.minimumRentalDays,
    km: fleetPolicy.dailyKmAllowance,
    extraKm: fleetPolicy.extraKmRate,
  };
  const fleetRows: FleetRow[] = vehicles.map((vehicle) => {
    const rate = rates.get(vehicle.id);
    const windows = getBlockedBookingWindows(vehicle.orders, 4);
    return {
      id: vehicle.id,
      plate: vehicle.plateNumber,
      title: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
      owner: vehicle.owner?.name ?? null,
      isArchived: vehicle.isArchived,
      turoCode: vehicle.turoVehicleCode,
      enabled: vehicle.directBookingEnabled,
      dailyRate: vehicle.bookingDailyRate,
      aiRate: rate?.suggestedDailyRate ?? null,
      insurance: vehicle.bookingInsuranceFee,
      deposit: vehicle.bookingDepositAmount,
      taxName: vehicle.bookingTaxName,
      taxRate: vehicle.bookingTaxRate,
      weekly: vehicle.bookingWeeklyDiscountPercent,
      minDays: vehicle.bookingMinimumRentalDays,
      km: vehicle.bookingDailyKmAllowance,
      extraKm: vehicle.bookingExtraKmRate,
      intro: vehicle.bookingIntro,
      photoCount: photoCounts.get(vehicle.id) ?? 0,
      // The admin route, not the public one: that serves only listed
      // cars, and the table shows unlisted ones too.
      thumbUrl: firstPhotoIds.has(vehicle.id)
        ? `/api/vehicles/${vehicle.id}/attachments/file?attachmentId=${firstPhotoIds.get(vehicle.id)}`
        : null,
      busy: windows.map(
        (window) => `${formatDate(window.pickupDatetime, locale)} – ${formatDate(window.returnDatetime, locale)}`,
      ),
      nextBusyAt: windows[0]?.pickupDatetime.getTime() ?? null,
      shareUrl: `${appUrl}/reserve/${vehicle.id}`,
    };
  });
  const stripeReady = Boolean(getStripeSecretKey());

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] p-3 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
          {directMessages.kicker}
        </p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <h2 className="font-serif text-[1.25rem] leading-tight text-[color:var(--ink)] sm:text-[1.45rem]">
              {directMessages.title}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-[color:var(--ink-soft)]">
              {directMessages.copy}
            </p>
          </div>
          <div className="rounded-full border border-[rgba(17,19,24,0.08)] bg-white/78 px-3 py-1.5 text-[11px] text-[color:var(--ink-soft)] shadow-[0_12px_24px_-24px_rgba(17,19,24,0.55)]">
            {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.enabledCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{enabledCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.readyCount}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">{readyCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[var(--surface)] px-3 py-2.5 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
              {directMessages.stripeStatus}
            </p>
            <p className="mt-1.5 text-[1.35rem] font-semibold text-[color:var(--ink)]">
              {stripeReady ? directMessages.stripeReady : directMessages.stripeMissing}
            </p>
          </div>
        </div>
      </section>

      <form
        action={saveBookingPolicyAction}
        className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-soft)]">
              {directMessages.policyKicker}
            </p>
            <h3 className="mt-1 text-[1.05rem] font-semibold text-[color:var(--ink)]">
              {directMessages.policyTitle}
            </h3>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
              {directMessages.policyCopy}
            </p>
          </div>
          {query.policySaved ? (
            <span className="rounded-md bg-[var(--ok-bg)] px-2.5 py-1 text-[11px] text-[color:var(--ok-fg)]">
              {directMessages.policySavedNotice}
            </span>
          ) : null}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            {
              name: "weeklyDiscountPercent",
              label: directMessages.policyWeeklyLabel,
              hint: directMessages.policyWeeklyHint,
              value: fleetPolicy.weeklyDiscountPercent,
              step: "0.1",
            },
            {
              name: "minimumRentalDays",
              label: directMessages.policyMinDaysLabel,
              hint: directMessages.policyMinDaysHint,
              value: fleetPolicy.minimumRentalDays,
              step: "1",
            },
            {
              name: "dailyKmAllowance",
              label: directMessages.policyKmLabel,
              hint: directMessages.policyKmHint,
              value: fleetPolicy.dailyKmAllowance,
              step: "1",
            },
            {
              name: "extraKmRate",
              label: directMessages.policyExtraKmLabel,
              hint: directMessages.policyExtraKmHint,
              value: fleetPolicy.extraKmRate,
              step: "0.01",
            },
            {
              name: "suggestedRateMultiplier",
              label: directMessages.policyMultiplierLabel,
              hint: directMessages.policyMultiplierHint,
              value: fleetPolicy.suggestedRateMultiplier,
              step: "0.05",
            },
            {
              name: "insuranceFee",
              label: directMessages.policyInsuranceLabel,
              hint: directMessages.policyInsuranceHint,
              value: fleetPolicy.insuranceFee,
              step: "0.01",
            },
            {
              name: "depositAmount",
              label: directMessages.policyDepositLabel,
              hint: directMessages.policyDepositHint,
              value: fleetPolicy.depositAmount,
              step: "1",
            },
            {
              name: "taxRate",
              label: directMessages.policyTaxRateLabel,
              hint: directMessages.policyTaxRateHint,
              value: fleetPolicy.taxRate,
              step: "0.001",
            },
          ].map((field) => (
            <label key={field.name} className="block min-w-0">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
                {field.label}
              </span>
              <input
                name={field.name}
                type="number"
                min="0"
                step={field.step}
                inputMode="decimal"
                defaultValue={field.value}
                className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium tabular-nums text-[color:var(--ink)]"
              />
              <span className="mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]">
                {field.hint}
              </span>
            </label>
          ))}
          <label className="block min-w-0">
            <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">
              {directMessages.policyTaxNameLabel}
            </span>
            <input
              name="taxName"
              defaultValue={fleetPolicy.taxName ?? ""}
              maxLength={40}
              className="w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] font-medium text-[color:var(--ink)]"
            />
            <span className="mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]">
              {directMessages.policyTaxNameHint}
            </span>
          </label>
        </div>

        <button
          type="submit"
          className="mt-3 rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {directMessages.policySaveAction}
        </button>
      </form>

      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">
          {directMessages.seasonalityTitle}
        </h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
          {seasonality.sampleSize > 0
            ? directMessages.seasonalityCopy(
                seasonality.sampleSize,
                formatCurrency(seasonality.medianDailyRate, locale),
              )
            : directMessages.seasonalityEmpty}
        </p>
        {seasonality.sampleSize > 0 ? (
          <div className="mt-3 grid grid-cols-6 gap-1.5 lg:grid-cols-12">
            {directMessages.seasonalityMonths.map((label, index) => {
              const factor = seasonality.monthIndex[index + 1];
              return (
                <div
                  key={label}
                  className="rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-1.5 py-2 text-center"
                >
                  <p className="text-[10px] text-[color:var(--ink-soft)]">{label}</p>
                  <p
                    className={`mt-1 text-[12px] font-semibold tabular-nums ${
                      factor == null
                        ? "text-[color:var(--ink-soft)]"
                        : factor > 1.05
                          ? "text-[color:var(--ok-fg)]"
                          : factor < 0.95
                            ? "text-[color:var(--bad-fg)]"
                            : "text-[color:var(--ink)]"
                    }`}
                  >
                    {factor == null ? "—" : `${factor.toFixed(2)}x`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <BookingLocationsEditor
        locale={locale}
        initialRows={bookingLocations.map((location) => ({
          id: location.id,
          label: location.label,
          address: location.address ?? "",
          fee: String(location.fee),
        }))}
        defaultIndex={Math.max(
          0,
          bookingLocations.findIndex((location) => location.isDefault),
        )}
        saved={Boolean(query.locationsSaved)}
      />

      <DirectBookingEmailEditor
        locale={locale}
        initialEnabled={emailTemplate?.isEnabled ?? true}
        initialSubject={normalizeDirectBookingEmailTemplate(emailTemplate).subjectTemplate}
        initialBody={normalizeDirectBookingEmailTemplate(emailTemplate).bodyTemplate}
        emailConfigured={isEmailConfigured()}
        saved={Boolean(query.emailSaved)}
      />

      {vehicles.length === 0 ? (
        <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-5 text-[12px] text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
          {directMessages.emptyState}
        </section>
      ) : null}

      <DirectBookingFleetTable locale={locale} rows={fleetRows} fleet={fleetDefaults} />
    </div>
  );
}
