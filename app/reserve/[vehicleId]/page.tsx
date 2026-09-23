import type { Metadata } from "next";
import { OrderAttachmentKind } from "@prisma/client";

import { CompactLanguageSwitcher } from "@/components/language-switcher";
import { PublicBookingPanel } from "@/components/public-booking-panel";
import { VehiclePhotoCarousel } from "@/components/vehicle-photo-carousel";
import { getBlockedBookingWindows, getDateOnlyBookingWindows } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import {
  buildVehicleSlug,
  findPublishedSiteByHost,
  getRequestHost,
  getSiteUrl,
} from "@/lib/rental-site";
import { prisma } from "@/lib/prisma";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { getStripeSecretKey } from "@/lib/stripe";
import { getWorkspaceConnectSnapshot } from "@/lib/stripe-connect";
import { isImageAttachment } from "@/lib/uploads";
import { formatCurrency, formatDate } from "@/lib/utils";

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

/**
 * Point search engines at the operator's own domain.
 *
 * The same car is reachable here and at `<their-domain>/cars/<slug>`.
 * Two URLs for one listing split whatever authority either earns, and
 * the wrong one can win -- a renter arriving on this page sees a
 * booking form with no shop around it. A canonical consolidates both
 * onto the address being advertised. Absent when the workspace has no
 * published site, because then this page is the only one there is.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}): Promise<Metadata> {
  const [{ vehicleId }, host] = await Promise.all([params, getRequestHost()]);
  const site = await findPublishedSiteByHost(host);
  if (!site) return {};

  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      workspaceId: site.workspaceId,
      isArchived: false,
      directBookingEnabled: true,
    },
    select: { id: true, brand: true, model: true, year: true },
  });
  if (!vehicle) return {};

  return {
    alternates: {
      canonical: getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`, host),
    },
  };
}

export default async function ReserveVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ vehicleId: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ vehicleId }, query, { locale, messages }] = await Promise.all([
    params,
    searchParams,
    getI18n(),
  ]);

  const reserveMessages = messages.reservePage;
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      owner: true,
      orders: {
        where: {
          isArchived: false,
          status: {
            not: "cancelled",
          },
        },
        orderBy: {
          pickupDatetime: "asc",
        },
      },
      attachments: {
        where: {
          isArchived: false,
          kind: OrderAttachmentKind.photo,
        },
        orderBy: {
          uploadedAt: "asc",
        },
      },
    },
  });

  const rate = vehicle
    ? resolveVehicleDailyRate(vehicle, await getBookingPolicyForVehicle(vehicle))
    : null;

  if (!vehicle || !vehicle.directBookingEnabled || !rate || !isVehicleBookable(rate)) {
    return (
      <main className="min-h-screen bg-[var(--page)] px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-4xl rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,0.92)] p-10 shadow-[0_30px_90px_rgba(17,19,24,0.08)]">
          <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--ink-soft)]">
            {reserveMessages.heroKicker}
          </p>
          <h1 className="mt-4 font-serif text-[3.6rem] leading-none text-[var(--ink)]">
            {reserveMessages.unavailableTitle}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
            {reserveMessages.unavailableCopy}
          </p>
        </div>
      </main>
    );
  }

  const blockedWindows = getBlockedBookingWindows(vehicle.orders, 6);
  const blockedDateWindows = getDateOnlyBookingWindows(vehicle.orders);
  const vehiclePhotos = vehicle.attachments
    .filter((attachment) => isImageAttachment(attachment.contentType, attachment.filename))
    .map((attachment) => ({
      id: attachment.id,
      src: `/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${attachment.id}`,
      alt: attachment.filename || vehicle.nickname,
    }));
  const stripeReady = Boolean(getStripeSecretKey());
  const policy = await getBookingPolicyForVehicle(vehicle);
  const dailyRate = rate.dailyRate ?? 0;
  const connectSnapshot = vehicle.workspaceId
    ? await getWorkspaceConnectSnapshot(vehicle.workspaceId)
    : null;
  const hostPayoutsReady = Boolean(
    connectSnapshot?.accountId && connectSnapshot.chargesEnabled,
  );
  const today = new Date();
  const defaultPickupDate = toDateInputValue(addDays(today, 1));
  const defaultReturnDate = toDateInputValue(addDays(today, 4));
  const checkoutState =
    query.checkout === "success" || query.checkout === "cancelled" || query.checkout === "error"
      ? query.checkout
      : "idle";

  return (
    <main className="min-h-screen bg-[var(--page)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[92rem] space-y-5">
        <header className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--ink)] text-xl font-semibold text-white">
              T
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">TATO</p>
              <h1 className="truncate text-2xl font-semibold text-[var(--ink)] sm:text-3xl">
                {vehicle.nickname}
              </h1>
            </div>
          </div>
          <CompactLanguageSwitcher locale={locale} />
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(24rem,0.88fr)]">
          <div className="space-y-5">
            <VehiclePhotoCarousel
              photos={vehiclePhotos}
              fallbackLabel={vehicle.nickname}
            />

            <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
                {reserveMessages.heroKicker}
              </p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-4xl">
                {vehicle.plateNumber} · {vehicle.brand} {vehicle.model} {vehicle.year}
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--ink-mid)]">
                {vehicle.bookingIntro?.trim() || reserveMessages.introFallback}
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {reserveMessages.rateLabel}
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                    {formatCurrency(dailyRate, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {reserveMessages.insuranceLabel}
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                    {formatCurrency(vehicle.bookingInsuranceFee, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {reserveMessages.depositLabel}
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                    {formatCurrency(vehicle.bookingDepositAmount, locale)}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {reserveMessages.ownerLabel}
                  </p>
                  <p className="mt-3 truncate text-lg font-semibold text-[var(--ink)]">
                    {vehicle.owner?.name ?? "TATO"}
                  </p>
                </div>
              </div>

              <div className="mt-6 border-t border-[var(--line)] pt-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
                  {reserveMessages.blockedDates}
                </p>
                {blockedWindows.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {blockedWindows.map((window) => (
                      <span
                        key={`${window.pickupDatetime.toISOString()}-${window.returnDatetime.toISOString()}`}
                        className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--ink-mid)]"
                      >
                        {formatDate(window.pickupDatetime, locale)} -{" "}
                        {formatDate(window.returnDatetime, locale)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    {reserveMessages.blockedDatesEmpty}
                  </p>
                )}
              </div>
            </section>
          </div>

          <div>
            <PublicBookingPanel
              locale={locale}
              vehicleId={vehicle.id}
              bookingDailyRate={dailyRate}
              bookingInsuranceFee={vehicle.bookingInsuranceFee ?? 0}
              bookingDepositAmount={vehicle.bookingDepositAmount ?? 0}
              bookingTaxName={vehicle.bookingTaxName}
              bookingTaxRate={vehicle.bookingTaxRate ?? 0}
            blockedDateWindows={blockedDateWindows}
            weeklyDiscountPercent={policy.weeklyDiscountPercent}
            minimumRentalDays={policy.minimumRentalDays}
            dailyKmAllowance={policy.dailyKmAllowance}
            extraKmRate={policy.extraKmRate}
              stripeReady={stripeReady}
              hostPayoutsReady={hostPayoutsReady}
              defaultPickupDate={defaultPickupDate}
              defaultReturnDate={defaultReturnDate}
              checkoutState={checkoutState}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
