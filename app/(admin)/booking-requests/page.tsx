import { BookingRequestKind, BookingRequestStatus } from "@prisma/client";

import { BookingRequestActions } from "@/components/booking-request-actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

export default async function BookingRequestsPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, requests] = await Promise.all([
    getI18n(),
    prisma.bookingChangeRequest.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            renterName: true,
            renterPhone: true,
            pickupDatetime: true,
            returnDatetime: true,
            vehicle: { select: { plateNumber: true, nickname: true } },
          },
        },
      },
    }),
  ]);

  const copy = messages.bookingRequestsPage;
  const pending = requests.filter((request) => request.status === BookingRequestStatus.PENDING);
  const resolved = requests.filter((request) => request.status !== BookingRequestStatus.PENDING);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-4">
        <h2 className="font-serif text-[1.25rem] text-[color:var(--ink)]">{copy.title}</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">{copy.empty}</p>
        ) : null}
      </section>

      {[...pending, ...resolved].map((request) => {
        const isCancel = request.kind === BookingRequestKind.CANCEL;
        const isPending = request.status === BookingRequestStatus.PENDING;

        return (
          <article
            key={request.id}
            className={`rounded-lg border px-4 py-3 ${
              isPending
                ? "border-[color:var(--warn-fg)]/25 bg-[var(--warn-bg)]"
                : "border-[color:var(--line)] bg-[rgba(255,255,255,0.88)]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[color:var(--ink)]">
                  {isCancel ? copy.kindCancel : copy.kindReschedule} ·{" "}
                  {request.order.vehicle.plateNumber} · {request.order.renterName}
                </p>
                <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">
                  {formatDate(request.order.pickupDatetime, locale)} –{" "}
                  {formatDate(request.order.returnDatetime, locale)}
                  {request.order.renterPhone ? ` · ${request.order.renterPhone}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[11px] text-[color:var(--ink-soft)]">
                {copy.requestedLabel} {formatDateTime(request.createdAt, locale)}
              </span>
            </div>

            {!isCancel && request.requestedPickupDate && request.requestedReturnDate ? (
              <p className="mt-2 text-[12px] text-[color:var(--ink-mid)]">
                → {formatDate(request.requestedPickupDate, locale)} –{" "}
                {formatDate(request.requestedReturnDate, locale)}
              </p>
            ) : null}

            {isCancel && request.quotedRefundAmount != null ? (
              <p className="mt-2 text-[12px] text-[color:var(--ink-mid)]">
                {copy.quotedRefundLabel}: {formatCurrency(request.quotedRefundAmount, locale)}
              </p>
            ) : null}

            {request.renterNote ? (
              <p className="mt-2 whitespace-pre-line rounded-md bg-white/70 px-3 py-2 text-[12px] leading-5 text-[color:var(--ink-mid)]">
                {request.renterNote}
              </p>
            ) : null}

            {isPending ? (
              <BookingRequestActions locale={locale} requestId={request.id} />
            ) : (
              <p className="mt-2 text-[11px] text-[color:var(--ink-soft)]">
                {request.status === BookingRequestStatus.APPROVED
                  ? copy.approvedLabel
                  : copy.declinedLabel}
                {request.refundedAmount
                  ? ` · ${copy.refundedLabel} ${formatCurrency(request.refundedAmount, locale)}`
                  : ""}
                {request.resolvedBy ? ` · ${request.resolvedBy}` : ""}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
