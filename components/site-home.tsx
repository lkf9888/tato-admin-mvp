import type { RentalSite } from "@prisma/client";
import Link from "next/link";

import { getSiteBasePath, type SiteFleetVehicle } from "@/lib/rental-site";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

/**
 * A rental site's front page: who this is, and what can be rented.
 *
 * The date filter is a plain GET form on purpose. It needs no
 * JavaScript, every state of it is a URL somebody can bookmark or send
 * to a passenger, and a crawler following the bare page still reaches
 * the whole fleet.
 */
export function SiteHome({
  site,
  locale,
  messages,
  fleet,
  pickupDate,
  returnDate,
}: {
  site: RentalSite;
  locale: Locale;
  messages: Messages;
  fleet: SiteFleetVehicle[];
  pickupDate: string;
  returnDate: string;
}) {
  const copy = messages.sitePublic;
  const base = getSiteBasePath(site);
  const hasRange = Boolean(pickupDate && returnDate);
  const availableCount = fleet.filter((vehicle) => vehicle.isAvailable !== false).length;
  // Bookable cars first when a range was asked for, so the answer to
  // "what can I have" is above the fold and the rest stays visible for
  // somebody willing to move their dates.
  const ordered = hasRange
    ? [...fleet].sort(
        (left, right) => Number(right.isAvailable ?? true) - Number(left.isAvailable ?? true),
      )
    : fleet;
  const dateQuery = hasRange
    ? `?${new URLSearchParams({ from: pickupDate, to: returnDate }).toString()}`
    : "";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <section>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight text-[var(--ink)] sm:text-[2.6rem]">
          {site.tagline?.trim() || site.brandName}
        </h1>
        {site.description ? (
          <p className="mt-4 max-w-2xl whitespace-pre-line text-[15px] leading-7 text-[var(--ink-mid)]">
            {site.description}
          </p>
        ) : null}
      </section>

      <section className="mt-8 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {copy.searchTitle}
        </p>
        <form method="get" action={`${base}/`} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="block text-[12px] font-medium text-[var(--ink-mid)]">
              {copy.pickupLabel}
            </span>
            <input
              type="date"
              name="from"
              defaultValue={pickupDate}
              className="mt-1 h-11 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)]"
            />
          </label>
          <label className="block">
            <span className="block text-[12px] font-medium text-[var(--ink-mid)]">
              {copy.returnLabel}
            </span>
            <input
              type="date"
              name="to"
              defaultValue={returnDate}
              className="mt-1 h-11 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)]"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="h-11 rounded-[var(--control-radius)] bg-[var(--brand)] px-6 text-sm font-semibold text-white"
            >
              {copy.searchAction}
            </button>
            {hasRange ? (
              <Link
                href={`${base}/`}
                className="h-11 rounded-[var(--control-radius)] border border-[var(--line-strong)] px-4 text-sm leading-[2.75rem] text-[var(--ink-mid)]"
              >
                {copy.clearAction}
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-[var(--ink)]">{copy.fleetTitle}</h2>
          <p className="text-[13px] text-[var(--ink-soft)]">
            {hasRange
              ? copy.resultsSummary(availableCount, fleet.length)
              : copy.fleetSummary(fleet.length)}
          </p>
        </div>

        {fleet.length === 0 ? (
          <p className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
            {copy.emptyFleet}
          </p>
        ) : hasRange && availableCount === 0 ? (
          <p className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
            {copy.emptyResults}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((vehicle) => {
            const unavailable = vehicle.isAvailable === false;

            return (
              <Link
                key={vehicle.id}
                href={`${base}/cars/${vehicle.slug}${dateQuery}`}
                className={`group flex flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] transition hover:border-[var(--brand)] ${
                  unavailable ? "opacity-55" : ""
                }`}
              >
                <div className="aspect-[4/3] w-full bg-[var(--surface-muted)]">
                  {vehicle.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={vehicle.photoUrl}
                      alt={`${vehicle.brand} ${vehicle.model} ${vehicle.year}`}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-[var(--ink-soft)]">
                      {vehicle.brand}
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-[var(--ink)]">
                        {vehicle.brand} {vehicle.model}
                      </p>
                      <p className="text-[12px] text-[var(--ink-soft)]">{vehicle.year}</p>
                    </div>
                    {hasRange ? (
                      <span
                        className={`shrink-0 rounded-[var(--radius-pill)] px-2 py-1 text-[11px] font-medium ${
                          unavailable
                            ? "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
                            : "bg-[var(--ok-bg)] text-[var(--ok-fg)]"
                        }`}
                      >
                        {unavailable ? copy.unavailableBadge : copy.availableBadge}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-2 border-t border-[var(--line)] pt-3">
                    <p className="text-[var(--ink)]">
                      <span className="text-xl font-semibold">
                        {formatCurrency(vehicle.dailyRate, locale)}
                      </span>
                      <span className="text-[12px] text-[var(--ink-soft)]"> {copy.perDay}</span>
                    </p>
                    <span className="text-[13px] font-medium text-[var(--brand)] group-hover:underline">
                      {copy.viewDetails}
                    </span>
                  </div>

                  {vehicle.depositAmount ? (
                    <p className="mt-2 text-[12px] text-[var(--ink-soft)]">
                      {copy.depositLabel} {formatCurrency(vehicle.depositAmount, locale)}
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
