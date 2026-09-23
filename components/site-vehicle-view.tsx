import type { Order, OrderAttachment, RentalSite, Vehicle } from "@prisma/client";
import Link from "next/link";

import { PublicBookingPanel } from "@/components/public-booking-panel";
import { VehiclePhotoCarousel } from "@/components/vehicle-photo-carousel";
import { getBlockedBookingWindows, getDateOnlyBookingWindows } from "@/lib/direct-booking";
import type { BookingPolicy } from "@/lib/booking-policy";
import { buildVehicleSlug, getSiteBasePath, getSiteUrl } from "@/lib/rental-site";
import { isImageAttachment } from "@/lib/uploads";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/utils";

export type SiteVehicle = Vehicle & {
  orders: Order[];
  attachments: OrderAttachment[];
};

/**
 * One car, on a rental site: photographs, the numbers, and the booking
 * panel the platform host already uses.
 *
 * The panel is imported rather than reimplemented. It is the piece
 * that takes money, and a second copy of it is a second place for a
 * pricing rule or a conflict check to drift out of step.
 */
export function SiteVehicleView({
  site,
  locale,
  messages,
  vehicle,
  policy,
  stripeReady,
  hostPayoutsReady,
  defaultPickupDate,
  defaultReturnDate,
  checkoutState,
}: {
  site: RentalSite;
  locale: Locale;
  messages: Messages;
  vehicle: SiteVehicle;
  policy: BookingPolicy;
  stripeReady: boolean;
  hostPayoutsReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  checkoutState: "idle" | "success" | "cancelled" | "error";
}) {
  const reserveMessages = messages.reservePage;
  const copy = messages.sitePublic;
  const base = getSiteBasePath(site);
  const blockedWindows = getBlockedBookingWindows(vehicle.orders, 6);
  const blockedDateWindows = getDateOnlyBookingWindows(vehicle.orders);
  const photos = vehicle.attachments
    .filter((attachment) => isImageAttachment(attachment.contentType, attachment.filename))
    .map((attachment) => ({
      id: attachment.id,
      src: `/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${attachment.id}`,
      alt: attachment.filename || vehicle.nickname,
    }));

  const canonical = getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Car",
    name: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
    brand: { "@type": "Brand", name: vehicle.brand },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    url: canonical,
    ...(photos.length > 0
      ? { image: photos.slice(0, 5).map((photo) => `${getSiteUrl(site, "")}${photo.src}`) }
      : {}),
    offers: {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "CAD",
      price: vehicle.bookingDailyRate ?? 0,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: vehicle.bookingDailyRate ?? 0,
        priceCurrency: "CAD",
        // UN/CEFACT code for "day" — what tells Google the price is a
        // daily rate and not the cost of the car.
        unitCode: "DAY",
      },
      seller: { "@type": "Organization", name: site.brandName },
    },
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <Link
        href={`${base}/`}
        className="text-[13px] text-[var(--ink-soft)] hover:text-[var(--brand)]"
      >
        ← {copy.backToFleet}
      </Link>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)]">
        <div className="space-y-5">
          <VehiclePhotoCarousel
            photos={photos}
            fallbackLabel={vehicle.nickname}
            brandLabel={site.brandName}
          />

          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
            <h1 className="text-2xl font-semibold leading-tight text-[var(--ink)] sm:text-3xl">
              {vehicle.brand} {vehicle.model} {vehicle.year}
            </h1>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-7 text-[var(--ink-mid)]">
              {vehicle.bookingIntro?.trim() || reserveMessages.introFallback}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {reserveMessages.rateLabel}
                </p>
                <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                  {formatCurrency(vehicle.bookingDailyRate, locale)}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {copy.insuranceLabel}
                </p>
                <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                  {formatCurrency(vehicle.bookingInsuranceFee, locale)}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {copy.depositLabel}
                </p>
                <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">
                  {formatCurrency(vehicle.bookingDepositAmount, locale)}
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
            bookingDailyRate={vehicle.bookingDailyRate ?? 0}
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
      </div>
    </main>
  );
}
