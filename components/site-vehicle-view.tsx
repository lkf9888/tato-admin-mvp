import type { Order, OrderAttachment, Vehicle } from "@prisma/client";
import Link from "next/link";

import { PublicBookingPanel } from "@/components/public-booking-panel";
import { VehiclePhotoCarousel } from "@/components/vehicle-photo-carousel";
import { getBlockedBookingWindows, getDateOnlyBookingWindows } from "@/lib/direct-booking";
import type { BookingPolicy } from "@/lib/booking-policy";
import { siteHref } from "@/components/site-shell";
import { buildVehicleSlug, getSiteOrigin, getSiteUrl } from "@/lib/rental-site";
import type { LocalizedSite } from "@/lib/rental-site-content";
import type { SiteLocale } from "@/lib/site-locale";
import { isImageAttachment } from "@/lib/uploads";
import type { Messages } from "@/lib/i18n";
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
  dailyRate,
  dailyRateOverrides,
  seasonalRates,
  locations,
  stripeReady,
  hostPayoutsReady,
  defaultPickupDate,
  defaultReturnDate,
  checkoutState,
}: {
  site: LocalizedSite;
  locale: SiteLocale;
  messages: Messages;
  vehicle: SiteVehicle;
  policy: BookingPolicy;
  /** Resolved: the operator's price, or the income model's. */
  dailyRate: number;
  dailyRateOverrides: Record<string, number>;
  seasonalRates: Record<string, number>;
  locations: { id: string; label: string; fee: number; isDefault: boolean }[];
  stripeReady: boolean;
  hostPayoutsReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  checkoutState: "idle" | "success" | "cancelled" | "error";
}) {
  const reserveMessages = messages.reservePage;
  const copy = messages.sitePublic;
  const blockedWindows = getBlockedBookingWindows(vehicle.orders, 6);
  const blockedDateWindows = getDateOnlyBookingWindows(vehicle.orders);
  const photos = vehicle.attachments
    .filter((attachment) => isImageAttachment(attachment.contentType, attachment.filename))
    .map((attachment) => ({
      id: attachment.id,
      src: `/api/direct-booking/vehicles/${vehicle.id}/attachments/file?attachmentId=${attachment.id}`,
      alt: attachment.filename || vehicle.nickname,
    }));

  const canonical = getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`, undefined, locale);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Car",
    name: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
    brand: { "@type": "Brand", name: vehicle.brand },
    model: vehicle.model,
    vehicleModelDate: String(vehicle.year),
    url: canonical,
    ...(photos.length > 0
      ? { image: photos.slice(0, 5).map((photo) => `${getSiteOrigin(site)}${photo.src}`) }
      : {}),
    offers: {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "CAD",
      price: dailyRate,
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: dailyRate,
        priceCurrency: "CAD",
        // UN/CEFACT code for "day" — what tells Google the price is a
        // daily rate and not the cost of the car.
        unitCode: "DAY",
      },
      seller: { "@type": "Organization", name: site.brandName },
    },
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <Link
        href={siteHref(site, locale, "/") === "/" ? "/#fleet" : `${siteHref(site, locale, "/")}#fleet`}
        className="inline-flex items-center gap-1 rounded-full px-1 text-[14px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand)]"
      >
        ← {copy.backToFleet}
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)] lg:items-start">
        <div className="space-y-5">
          <VehiclePhotoCarousel
            photos={photos}
            fallbackLabel={vehicle.nickname}
            brandLabel={site.brandName}
          />

          <section className="site-card p-6">
            <h1 className="text-[1.9rem] font-bold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.3rem]">
              {vehicle.brand} {vehicle.model} {vehicle.year}
            </h1>
            <p className="mt-4 max-w-3xl whitespace-pre-line text-[15px] leading-7 text-[var(--ink-mid)]">
              {/* The car's own intro is written in one language; on the
                  other two the platform's localized line reads better
                  than a paragraph in a language the visitor chose not
                  to read. */}
              {(locale === "en" ? vehicle.bookingIntro?.trim() : "") || copy.vehicleIntroFallback}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[18px] bg-[var(--brand-tint)] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-deep)]">
                  {reserveMessages.rateLabel}
                </p>
                <p className="mt-2 text-[1.6rem] font-bold tracking-[-0.02em] text-[var(--ink)]">
                  {formatCurrency(dailyRate, locale)}
                </p>
              </div>
              <div className="rounded-[18px] bg-[var(--brand-tint)] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-deep)]">
                  {copy.insuranceLabel}
                </p>
                <p className="mt-2 text-[1.6rem] font-bold tracking-[-0.02em] text-[var(--ink)]">
                  {formatCurrency(policy.insuranceFee, locale)}
                </p>
              </div>
              <div className="rounded-[18px] bg-[var(--brand-tint)] p-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-deep)]">
                  {copy.depositLabel}
                </p>
                <p className="mt-2 text-[1.6rem] font-bold tracking-[-0.02em] text-[var(--ink)]">
                  {formatCurrency(policy.depositAmount, locale)}
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
                      className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] text-[var(--ink-mid)]"
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

        <div className="lg:sticky lg:top-24">
          <PublicBookingPanel
            locale={locale}
            vehicleId={vehicle.id}
            bookingDailyRate={dailyRate}
            bookingInsuranceFee={policy.insuranceFee}
            bookingDepositAmount={policy.depositAmount}
            bookingTaxName={policy.taxName}
            bookingTaxRate={policy.taxRate}
            blockedDateWindows={blockedDateWindows}
            dailyRateOverrides={dailyRateOverrides}
            seasonalRates={seasonalRates}
            locations={locations}
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
