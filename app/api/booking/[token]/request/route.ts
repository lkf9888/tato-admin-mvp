import { NextResponse } from "next/server";
import { z } from "zod";

import {
  areRequestedDatesFree,
  canRequestChange,
  loadBookingByToken,
  quoteCancellation,
} from "@/lib/booking-access";
import { BookingRequestKind } from "@prisma/client";
import { dateOnlyToUtcMidday, isDateOnlyRangeValid } from "@/lib/direct-booking";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

const bodySchema = z.object({
  kind: z.enum(["CANCEL", "RESCHEDULE"]),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

  if (body.kind === "RESCHEDULE") {
    if (!body.pickupDate || !body.returnDate) {
      return NextResponse.json({ error: "DATES_REQUIRED" }, { status: 400 });
    }
    if (!isDateOnlyRangeValid(body.pickupDate, body.returnDate)) {
      return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
    }

    // Told now rather than a day later: a clash the renter could have
    // seen is not worth an email exchange to discover.
    const free = await areRequestedDatesFree({
      vehicleId: order.vehicleId,
      excludeOrderId: order.id,
      pickupDate: body.pickupDate,
      returnDate: body.returnDate,
    });
    if (!free) {
      return NextResponse.json({ error: "DATES_UNAVAILABLE" }, { status: 409 });
    }

    requestedPickupDate = dateOnlyToUtcMidday(body.pickupDate);
    requestedReturnDate = dateOnlyToUtcMidday(body.returnDate);
  } else {
    const quote = quoteCancellation(order);
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
      pickupDate: body.pickupDate ?? null,
      returnDate: body.returnDate ?? null,
    },
  });

  return NextResponse.json({ ok: true, requestId: created.id });
}
