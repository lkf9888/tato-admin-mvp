"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { FROM_PRICE_WINDOW_DAYS } from "@/lib/site-display-price";
import { formatCurrency } from "@/lib/utils";

/**
 * The daily price at the top of a car's page, kept in step with the
 * booking panel beside it (TT-20).
 *
 * Until the renter chooses dates the tile shows the car's "from" price:
 * the cheapest trip bookable in the next 90 days. The panel's starting
 * dates are a suggestion, not a choice, so they do not count. Once the
 * renter picks dates, times or a licence, the panel reports that trip's
 * average per day and the tile shows it -- the same figure as the
 * panel's own vehicle price over its days.
 */

export type ReportedTripPrice = {
  /** Rent after the weekly rate, plus insurance, per charged day. */
  dailyPrice: number;
  /** The renter said they hold a licence from outside BC. */
  nonLocal: boolean;
} | null;

const TripPriceContext = createContext<{
  trip: ReportedTripPrice;
  setTrip: (trip: ReportedTripPrice) => void;
} | null>(null);

export function TripPriceProvider({ children }: { children: ReactNode }) {
  const [trip, setTrip] = useState<ReportedTripPrice>(null);
  return <TripPriceContext.Provider value={{ trip, setTrip }}>{children}</TripPriceContext.Provider>;
}

/** Called by the booking panel; a no-op on a page without the tile. */
export function useReportTripPrice(trip: ReportedTripPrice) {
  const context = useContext(TripPriceContext);
  const setTrip = context?.setTrip;
  const dailyPrice = trip?.dailyPrice ?? null;
  const nonLocal = trip?.nonLocal ?? false;
  useEffect(() => {
    setTrip?.(dailyPrice == null ? null : { dailyPrice, nonLocal });
  }, [setTrip, dailyPrice, nonLocal]);
}

export function VehicleDailyPrice({
  locale,
  fromDailyPrice,
  licenceSurcharge,
  className,
  noteClassName,
}: {
  locale: Locale;
  /** Null: nothing bookable in the next 90 days. */
  fromDailyPrice: number | null;
  licenceSurcharge: number;
  className?: string;
  noteClassName?: string;
}) {
  const copy = getMessages(locale).sitePublic;
  const trip = useContext(TripPriceContext)?.trip ?? null;
  const note = noteClassName ?? "mt-1 text-[11px] leading-4 text-[var(--ink-soft)] sm:text-[12px]";

  if (trip) {
    return (
      <>
        <p className={className}>
          {formatCurrency(trip.dailyPrice, locale)}
          <span className="text-[0.55em] font-medium text-[var(--ink-soft)]"> {copy.perDay}</span>
        </p>
        <p className={note}>{copy.priceTripNote}</p>
        {trip.nonLocal ? (
          <p className={note}>{copy.licenceNonLocalNote}</p>
        ) : licenceSurcharge > 0 ? (
          <p className={note}>{copy.licenceNote(formatCurrency(licenceSurcharge, locale))}</p>
        ) : null}
      </>
    );
  }

  if (fromDailyPrice == null) {
    return <p className={note}>{copy.priceNoDates(FROM_PRICE_WINDOW_DAYS)}</p>;
  }

  return (
    <>
      <p className={className}>
        <span className="text-[0.55em] font-medium text-[var(--ink-soft)]">{copy.priceFromLead} </span>
        {formatCurrency(fromDailyPrice, locale)}
        <span className="text-[0.55em] font-medium text-[var(--ink-soft)]"> {copy.priceFromTail}</span>
      </p>
      <p className={note}>{copy.priceFromNote(FROM_PRICE_WINDOW_DAYS)}</p>
      {licenceSurcharge > 0 ? (
        <p className={note}>{copy.licenceNote(formatCurrency(licenceSurcharge, locale))}</p>
      ) : null}
    </>
  );
}
