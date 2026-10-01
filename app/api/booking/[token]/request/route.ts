import { NextResponse } from "next/server";
import { z } from "zod";

import {
  areRequestedDatesFree,
  canRequestChange,
  loadBookingByToken,
  quoteCancellation,
} from "@/lib/booking-access";
import { BookingRequestKind } from "@prisma/client";
import {
  DEFAULT_BOOKING_TIME,
  isDateOnlyMoment,
  utcToZonedTime,
  zonedDateTimeToUtc,
} from "@/lib/booking-time";
import { sendChangeRequestNotice } from "@/lib/direct-booking-email";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { earliestPickupAt } from "@/lib/direct-booking";
import { quoteReschedule } from "@/lib/booking-reschedule";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

const bodySchema = z.object({
  kind: z.enum(["CANCEL", "RESCHEDULE"]),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // `HH:MM` on the operator's clock. A page from before times were
  // asked for sends none; the trip's own times of day are kept then.
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * A renter asking to cancel or move their booking.
 *
 * Records a request; it never changes the trip. Approving is the
 * operator's, because a date change has to clear the rest of the
 * fleet's calendar and a refund is money leaving the business.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const order = await loadBookingByToken(token);
  if (!order) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (!canRequestChange(order)) {
    return NextResponse.json({ error: "REQUEST_NOT_ALLOWED" }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const body = parsed.data;

  let requestedPickupDate: Date | null = null;
  let requestedReturnDate: Date | null = null;
  let quotedRefundAmount: number | null = null;
  let quotedPriceDifference: number | null = null;

  if (body.kind === "RESCHEDULE") {
    if (!body.pickupDate || !body.returnDate) {
      return NextResponse.json({ error: "DATES_REQUIRED" }, { status: 400 });
    }
    const keepTime = (value: Date) =>
      isDateOnlyMoment(value) ? DEFAULT_BOOKING_TIME : utcToZonedTime(value);
    const pickupAt = zonedDateTimeToUtc(
      body.pickupDate,
      body.pickupTime ?? keepTime(order.pickupDatetime),
    );
    const returnAt = zonedDateTimeToUtc(
      body.returnDate,
      body.returnTime ?? keepTime(order.returnDatetime),
    );
    if (!pickupAt || !returnAt || returnAt <= pickupAt) {
      return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
    }
    if (pickupAt.getTime() < Date.now() - 15 * 60_000) {
      return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
    }
    // A moved trip keeps to the same lead time as a new booking.
    const policy = await getBookingPolicyForVehicle(order.vehicle);
    if (
      pickupAt.getTime() !== order.pickupDatetime.getTime() &&
      pickupAt < earliestPickupAt(policy.bookingNoticeHours, new Date(Date.now() - 5 * 60_000))
    ) {
      return NextResponse.json({ error: "TOO_SOON" }, { status: 400 });
    }

    // Told now rather than a day later: a clash the renter could have
    // seen is not worth an email exchange to discover.
    const free = await areRequestedDatesFree({
      vehicleId: order.vehicleId,
      excludeOrderId: order.id,
      pickupAt,
      returnAt,
    });
    if (!free) {
      return NextResponse.json({ error: "DATES_UNAVAILABLE" }, { status: 409 });
    }

    requestedPickupDate = pickupAt;
    requestedReturnDate = returnAt;
    // The price difference as the renter is shown it now; approval
    // settles exactly this, whatever the clock says by then.
    quotedPriceDifference = (await quoteReschedule({ orderId: order.id, pickupAt, returnAt })).settlement;
  } else {
    const quote = await quoteCancellation(order);
    if (!quote.isSelfServiceEligible) {
      return NextResponse.json({ error: "ALREADY_STARTED" }, { status: 409 });
    }
    // Captured at request time. The free-cancellation window keeps
    // closing, so a figure recomputed at approval would answer a
    // different question than the one the renter was shown.
    quotedRefundAmount = quote.refundAmount;
  }

  const created = await prisma.bookingChangeRequest.create({
    data: {
      workspaceId: order.workspaceId,
      orderId: order.id,
      kind: body.kind as BookingRequestKind,
      requestedPickupDate,
      requestedReturnDate,
      renterNote: body.note?.trim() || null,
      quotedRefundAmount,
      quotedPriceDifference,
    },
  });

  await logActivity({
    workspaceId: order.workspaceId ?? undefined,
    actor: order.renterName,
    action:
      body.kind === "CANCEL" ? "booking_cancel_requested" : "booking_reschedule_requested",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      requestId: created.id,
      quotedRefundAmount,
      pickupAt: requestedPickupDate?.toISOString() ?? null,
      returnAt: requestedReturnDate?.toISOString() ?? null,
    },
  });

  // The operator hears about it now, not whenever they next open the
  // requests page.
  if (order.workspaceId) {
    await sendChangeRequestNotice({
      workspaceId: order.workspaceId,
      order,
      vehicle: order.vehicle,
      kind: body.kind,
      requestedPickup: requestedPickupDate,
      requestedReturn: requestedReturnDate,
      quotedRefund: quotedRefundAmount,
      renterNote: body.note?.trim() || null,
    });
  }

  return NextResponse.json({ ok: true, requestId: created.id });
}
