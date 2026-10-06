import type { Metadata } from "next";
import { BookingRequestKind, BookingRequestStatus, OrderStatus } from "@prisma/client";

import { BookingChangeForm } from "@/components/booking-change-form";
import { BookingHandoverRenter } from "@/components/booking-handover-renter";
import { SiteShell } from "@/components/site-shell";
import { getLocalizedSite } from "@/lib/rental-site-page";
import {
  canRequestChange,
  getAmountsPaid,
  getOpenRequest,
  loadBookingByToken,
  quoteCancellation,
} from "@/lib/booking-access";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";
import {
  DEFAULT_BOOKING_TIME,
  formatBookingMoment,
  isDateOnlyMoment,
  utcToZonedDate,
  utcToZonedTime,
} from "@/lib/booking-time";
import { formatCurrency, formatDate } from "@/lib/utils";

type Params = Promise<{ token: string }>;

/**
 * Never a search result, and never our name.
 *
 * A static `metadata` export left the title falling back to the root
 * layout's, so a renter looking at their own booking on the
 * operator's domain had TATO in their browser tab. The page had every
 * other pixel branded correctly.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const robots = { index: false, follow: false };
  const { token } = await params;
  const order = await loadBookingByToken(token);
  if (!order?.workspaceId) return { robots };

  const site = await prisma.rentalSite.findUnique({
    where: { workspaceId: order.workspaceId },
    select: { brandName: true },
  });
  const workspace = site
    ? null
    : await prisma.workspace.findUnique({
        where: { id: order.workspaceId },
        select: { name: true },
      });
  const brand = site?.brandName?.trim() || workspace?.name?.trim();

  return brand ? { title: brand, robots } : { robots };
}

export default async function RenterBookingPage({ params }: { params: Params }) {
  const [{ token }, { locale, messages }] = await Promise.all([params, getI18n()]);
  const copy = messages.bookingPage;
  const order = await loadBookingByToken(token);

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{copy.notFoundTitle}</h1>
        <p className="mt-3 text-sm leading-7 text-[var(--ink-mid)]">{copy.notFoundCopy}</p>
      </main>
    );
  }

  const site = order.workspaceId
    ? await prisma.rentalSite.findUnique({ where: { workspaceId: order.workspaceId } })
    : null;
  const amounts = getAmountsPaid(order);
  const [quote, policy] = await Promise.all([
    quoteCancellation(order),
    getBookingPolicyForVehicle(order.vehicle),
  ]);
  const cancellationTerms = messages.cancellationPolicies;
  const openRequest = getOpenRequest(order);
  const lastResolved = order.changeRequests.find(
    (request) => request.status === BookingRequestStatus.DECLINED,
  );
  const isCancelled = order.status === OrderStatus.cancelled;
  const today = utcToZonedDate(new Date());
  // What the renter will want to look up on the day: where to go, what
  // they added, and the agreement they signed.
  const extras = decodeExtras(order.sourceMetadata);
  const envelope = await prisma.contractEnvelope.findFirst({
    where: { orderId: order.id, status: { not: "VOIDED" } },
    orderBy: { createdAt: "desc" },
    include: { recipients: { orderBy: { signingOrder: "asc" }, take: 1 } },
  });
  const signer = envelope?.recipients[0];
  const agreementLink =
    envelope && signer
      ? envelope.status === "COMPLETED" && envelope.signedPdfUrl
        ? { href: `${envelope.signedPdfUrl}?token=${encodeURIComponent(signer.token)}`, signed: true }
        : { href: `${getAppUrl().replace(/\/$/, "")}/sign/${signer.token}`, signed: false }
      : null;

  // The policy they booked under first, then what it means today.
  const policyLine = `${cancellationTerms.label} · ${cancellationTerms[policy.cancellationPolicy].name}: ${cancellationTerms[policy.cancellationPolicy].summary}`;
  const outcomeCopy =
    quote.outcome === "free"
      ? copy.cancelFreeCopy(formatCurrency(quote.refundAmount, locale))
      : quote.outcome === "late"
        ? copy.cancelLateCopy(
            formatCurrency(quote.refundAmount, locale),
            formatCurrency(quote.penaltyAmount, locale),
          )
        : copy.cancelStartedCopy;
  const cancelCopy = `${policyLine} ${outcomeCopy}`;

  const body = (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">{copy.kicker}</p>
      <h1 className="mt-3 text-2xl font-semibold text-[var(--ink)] sm:text-3xl">
        {order.vehicle.brand} {order.vehicle.model} {order.vehicle.year}
      </h1>

      {isCancelled ? (
        <p className="mt-4 rounded-md border border-[color:var(--bad-fg)]/20 bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[color:var(--bad-fg)]">
          {copy.cancelledNotice}
        </p>
      ) : null}

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        {[
          [copy.referenceLabel, order.id.slice(-8).toUpperCase()],
          // Date and time on the operator's clock; the server renders
          // in UTC, where an evening pickup is already tomorrow.
          [copy.pickupLabel, formatTripMoment(order.pickupDatetime)],
          [copy.returnLabel, formatTripMoment(order.returnDatetime)],
          [copy.paidLabel, formatCurrency(amounts.paidAmount, locale)],
          ...(amounts.outstanding > 0
            ? [[copy.outstandingLabel, formatCurrency(amounts.outstanding, locale)]]
            : []),
          ...(amounts.depositAmount > 0
            ? [[copy.depositLabel, formatCurrency(amounts.depositAmount, locale)]]
            : []),
          ...(order.pickupLocation
            ? [[copy.pickupPlaceLabel, order.pickupLocation, "wide"]]
            : []),
          ...(order.returnLocation && order.returnLocation !== order.pickupLocation
            ? [[copy.returnPlaceLabel, order.returnLocation, "wide"]]
            : []),
          ...(extras.length > 0 ? [[copy.extrasLabel, extras.join(", "), "wide"]] : []),
        ].map(([label, value, width]) => (
          <div
            key={label}
            className={`rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 ${
              width === "wide" ? "sm:col-span-2" : ""
            }`}
          >
            <dt className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              {label}
            </dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-[var(--ink)]">{value}</dd>
          </div>
        ))}
      </dl>

      {agreementLink ? (
        <p className="mt-3 text-[13px]">
          <a href={agreementLink.href} target="_blank" rel="noreferrer" className="font-medium text-[var(--brand)] underline">
            {agreementLink.signed ? copy.agreementSignedLink : copy.agreementSignLink}
          </a>
        </p>
      ) : null}

      {order.orderPayments.length > 1 ? (
        <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">{copy.scheduleTitle}</h2>
          <ul className="mt-3 space-y-2 text-[13px] text-[var(--ink-mid)]">
            {order.orderPayments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3">
                <span>
                  {payment.dueAt ? formatDate(payment.dueAt, locale) : "—"} ·{" "}
                  {payment.paidAt ? copy.schedulePaid : copy.scheduleDue}
                </span>
                <span className="tabular-nums">{formatCurrency(payment.amount, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {openRequest ? (
        <section className="mt-6 rounded-lg border border-[color:var(--warn-fg)]/25 bg-[var(--warn-bg)] p-5">
          <h2 className="text-sm font-semibold text-[color:var(--warn-fg)]">{copy.pendingTitle}</h2>
          <p className="mt-1.5 text-[13px] leading-6 text-[color:var(--warn-fg)]">
            {openRequest.kind === BookingRequestKind.CANCEL
              ? copy.pendingCancel
              : copy.pendingReschedule(
                  openRequest.requestedPickupDate
                    ? formatBookingMoment(openRequest.requestedPickupDate)
                    : "—",
                  openRequest.requestedReturnDate
                    ? formatBookingMoment(openRequest.requestedReturnDate)
                    : "—",
                )}
          </p>
        </section>
      ) : lastResolved && !isCancelled ? (
        <p className="mt-6 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[var(--ink-mid)]">
          {copy.declinedNotice}
        </p>
      ) : null}

      {!isCancelled ? (
        <BookingHandoverRenter
          locale={locale}
          token={token}
          returnOpen={Date.now() >= order.pickupDatetime.getTime() - 60 * 60_000}
        />
      ) : null}

      {!isCancelled ? (
        <BookingChangeForm
          locale={locale}
          token={token}
          canRequest={canRequestChange(order)}
          cancelOutcome={quote.outcome}
          cancelCopy={cancelCopy}
          minDate={today}
          defaultPickupDate={utcToZonedDate(order.pickupDatetime)}
          defaultReturnDate={utcToZonedDate(order.returnDatetime)}
          defaultPickupTime={
            isDateOnlyMoment(order.pickupDatetime) ? DEFAULT_BOOKING_TIME : utcToZonedTime(order.pickupDatetime)
          }
          defaultReturnTime={
            isDateOnlyMoment(order.returnDatetime) ? DEFAULT_BOOKING_TIME : utcToZonedTime(order.returnDatetime)
          }
        />
      ) : null}

      {site?.contactPhone || site?.contactEmail ? (
        <section className="mt-6 text-[13px] text-[var(--ink-soft)]">
          <p className="font-medium text-[var(--ink-mid)]">{copy.helpTitle}</p>
          <p className="mt-1">
            {[site.contactPhone, site.contactEmail].filter(Boolean).join(" · ")}
          </p>
        </section>
      ) : null}
    </main>
  );

  // Wrapped in the operator's own chrome when they have a site, so the
  // renter stays inside the brand they booked with.
  return site ? (
    // The language menu leads to the site's home: this page is reached
    // by a private link and has no public address in other languages.
    <SiteShell site={getLocalizedSite(site, locale)} locale={locale} path="/" messages={messages}>
      {body}
    </SiteShell>
  ) : (
    <div className="min-h-screen bg-[var(--page)]">{body}</div>
  );
}

function formatTripMoment(value: Date) {
  return formatBookingMoment(value);
}

/** The extras a booking bought, by name, from what checkout recorded. */
function decodeExtras(sourceMetadata: string | null): string[] {
  try {
    const parsed = JSON.parse(sourceMetadata ?? "{}") as { addOns?: Array<{ name?: unknown }> | null };
    return (parsed.addOns ?? [])
      .map((item) => (typeof item?.name === "string" ? item.name : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}
