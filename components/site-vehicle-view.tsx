import type { Order, OrderAttachment, Vehicle } from "@prisma/client";
import Link from "next/link";

import { PublicBookingPanel } from "@/components/public-booking-panel";
import { VehiclePhotoCarousel } from "@/components/vehicle-photo-carousel";
import { parseVehicleFeatures, VEHICLE_FEATURE_LABELS } from "@/lib/vehicle-features";
import {
  getBookingBusyWindows,
  getDateOnlyBookingWindows,
} from "@/lib/direct-booking";
import type { BookingPolicy } from "@/lib/booking-policy";
import type { BookingAddOnOption } from "@/lib/booking-add-ons";
import { siteHref } from "@/components/site-shell";
import { buildVehicleSlug, getSiteOrigin, getSiteUrl } from "@/lib/rental-site";
import type { LocalizedSite } from "@/lib/rental-site-content";
import type { SiteLocale } from "@/lib/site-locale";
import { isImageAttachment } from "@/lib/uploads";
import type { Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

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
  addOns,
  stripeReady,
  hostPayoutsReady,
  defaultPickupDate,
  defaultReturnDate,
  agreementClauses = null,
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
  addOns: BookingAddOnOption[];
  stripeReady: boolean;
  hostPayoutsReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  /** The operator's own clauses, when they have edited them. */
  agreementClauses?: Array<{ heading: string; body: string }> | null;
  checkoutState: "idle" | "success" | "cancelled" | "error";
}) {
  const reserveMessages = messages.reservePage;
  const copy = messages.sitePublic;
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
    <main className="mx-auto max-w-6xl px-3 py-3 sm:px-6 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />

      <Link
        href={siteHref(site, locale, "/") === "/" ? "/#fleet" : `${siteHref(site, locale, "/")}#fleet`}
        className="inline-flex items-center gap-1 rounded-full px-1 text-[13px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand)] sm:text-[14px]"
      >
        ← {copy.backToFleet}
      </Link>

      <div className="mt-2 grid gap-3 sm:mt-4 sm:gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)] lg:items-start">
        <div className="space-y-3 sm:space-y-5">
          <VehiclePhotoCarousel
            photos={photos}
            fallbackLabel={vehicle.nickname}
            brandLabel={site.brandName}
          />

          <section className="site-card p-4 sm:p-6">
            <h1 className="text-[1.3rem] font-bold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[2.3rem]">
              {vehicle.brand} {vehicle.model} {vehicle.year}
            </h1>
            <p className="mt-1.5 max-w-3xl whitespace-pre-line text-[13px] leading-5 text-[var(--ink-mid)] sm:mt-4 sm:text-[15px] sm:leading-7">
              {/* The car's own intro is written in one language; on the
                  other two the platform's localized line reads better
                  than a paragraph in a language the visitor chose not
                  to read. */}
              {(locale === "en" ? vehicle.bookingIntro?.trim() : "") || copy.vehicleIntroFallback}
            </p>
            {parseVehicleFeatures(vehicle.bookingFeatures).length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
                {parseVehicleFeatures(vehicle.bookingFeatures).map((feature) => (
                  <li
                    key={feature}
                    className="rounded-full border border-[var(--line)] bg-white px-2.5 py-0.5 text-[12px] text-[var(--ink-mid)] sm:px-3 sm:py-1 sm:text-[13px]"
                  >
                    {VEHICLE_FEATURE_LABELS[locale][feature]}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
              <div className="rounded-xl bg-[var(--brand-tint)] p-2.5 sm:rounded-[18px] sm:p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--brand-deep)] sm:text-[12px] sm:tracking-[0.08em]">
                  {reserveMessages.rateLabel}
                </p>
                <p className="mt-1 text-[1rem] font-bold tracking-[-0.02em] text-[var(--ink)] sm:mt-2 sm:text-[1.6rem]">
                  {formatCurrency(dailyRate, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--brand-tint)] p-2.5 sm:rounded-[18px] sm:p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--brand-deep)] sm:text-[12px] sm:tracking-[0.08em]">
                  {copy.insuranceLabel}
                </p>
                <p className="mt-1 text-[1rem] font-bold tracking-[-0.02em] text-[var(--ink)] sm:mt-2 sm:text-[1.6rem]">
                  {formatCurrency(policy.insuranceFee, locale)}
                </p>
                {policy.insuranceFeeNonLocal !== policy.insuranceFee ? (
                  <p className="mt-0.5 text-[10px] leading-3 text-[var(--ink-mid)] sm:mt-1 sm:text-[12px] sm:leading-4">
                    {messages.reservePage.insuranceNonLocalNote(formatCurrency(policy.insuranceFeeNonLocal, locale))}
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl bg-[var(--brand-tint)] p-2.5 sm:rounded-[18px] sm:p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--brand-deep)] sm:text-[12px] sm:tracking-[0.08em]">
                  {copy.depositLabel}
                </p>
                <p className="mt-1 text-[1rem] font-bold tracking-[-0.02em] text-[var(--ink)] sm:mt-2 sm:text-[1.6rem]">
                  {formatCurrency(policy.depositAmount, locale)}
                </p>
              </div>
            </div>

          </section>
        </div>

        <div className="lg:sticky lg:top-24">
          <PublicBookingPanel
            locale={locale}
            vehicleId={vehicle.id}
            bookingDailyRate={dailyRate}
            bookingInsuranceFee={policy.insuranceFee}
            bookingInsuranceFeeNonLocal={policy.insuranceFeeNonLocal}
            bookingDepositAmount={policy.depositAmount}
            bookingTaxName={policy.taxName}
            bookingTaxRate={policy.taxRate}
            taxLines={policy.taxLines}
            blockedDateWindows={blockedDateWindows}
            busyWindows={getBookingBusyWindows(vehicle.orders)}
            returnGraceMinutes={policy.returnGraceMinutes}
            dailyRateOverrides={dailyRateOverrides}
            seasonalRates={seasonalRates}
            locations={locations}
            addOns={addOns}
            weeklyDiscountPercent={policy.weeklyDiscountPercent}
            minimumRentalDays={policy.minimumRentalDays}
            dailyKmAllowance={policy.dailyKmAllowance}
            extraKmRate={policy.extraKmRate}
            stripeReady={stripeReady}
            hostPayoutsReady={hostPayoutsReady}
            defaultPickupDate={defaultPickupDate}
            defaultReturnDate={defaultReturnDate}
            agreementClauses={agreementClauses}
            checkoutState={checkoutState}
          />
        </div>
      </div>
    </main>
  );
}
