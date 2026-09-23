import type { Metadata } from "next";
import { BookingRequestKind, BookingRequestStatus, OrderStatus } from "@prisma/client";

import { BookingChangeForm } from "@/components/booking-change-form";
import { SiteShell } from "@/components/site-shell";
import {
  canRequestChange,
  getAmountsPaid,
  getOpenRequest,
  loadBookingByToken,
  quoteCancellation,
  toDateOnly,
} from "@/lib/booking-access";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

/** A renter's link to their own booking is never a search result. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Params = Promise<{ token: string }>;

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
  const quote = quoteCancellation(order);
  const openRequest = getOpenRequest(order);
  const lastResolved = order.changeRequests.find(
    (request) => request.status === BookingRequestStatus.DECLINED,
  );
  const isCancelled = order.status === OrderStatus.cancelled;
  const today = toDateOnly(new Date());

  const cancelCopy =
    quote.outcome === "free"
      ? copy.cancelFreeCopy(formatCurrency(quote.refundAmount, locale))
      : quote.outcome === "late"
        ? copy.cancelLateCopy(
            formatCurrency(quote.refundAmount, locale),
            formatCurrency(quote.penaltyAmount, locale),
          )
        : copy.cancelStartedCopy;

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
          [copy.pickupLabel, formatDate(order.pickupDatetime, locale)],
          [copy.returnLabel, formatDate(order.returnDatetime, locale)],
          [copy.paidLabel, formatCurrency(amounts.paidAmount, locale)],
          ...(amounts.outstanding > 0
            ? [[copy.outstandingLabel, formatCurrency(amounts.outstanding, locale)]]
            : []),
          ...(amounts.depositAmount > 0
            ? [[copy.depositLabel, formatCurrency(amounts.depositAmount, locale)]]
            : []),
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3"
          >
            <dt className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              {label}
            </dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-[var(--ink)]">{value}</dd>
          </div>
        ))}
      </dl>

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
                    ? formatDate(openRequest.requestedPickupDate, locale)
                    : "—",
                  openRequest.requestedReturnDate
                    ? formatDate(openRequest.requestedReturnDate, locale)
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
        <BookingChangeForm
          locale={locale}
          token={token}
          canRequest={canRequestChange(order)}
          cancelOutcome={quote.outcome}
          cancelCopy={cancelCopy}
          minDate={today}
          defaultPickupDate={toDateOnly(order.pickupDatetime)}
          defaultReturnDate={toDateOnly(order.returnDatetime)}
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
    <SiteShell site={site} locale={locale}>
      {body}
    </SiteShell>
  ) : (
    <div className="min-h-screen bg-[var(--page)]">{body}</div>
  );
}
