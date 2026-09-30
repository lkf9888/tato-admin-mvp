import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingRequestKind, BookingRequestStatus, type Order } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { areRequestedDatesFree } from "@/lib/booking-access";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";
import {
  isDateOnlyMoment,
  utcToZonedDate,
  utcToZonedTime,
  zonedDateTimeToUtc,
} from "@/lib/booking-time";
import { cancelDirectBookingWithRefund } from "@/lib/direct-booking-cancel";
import { sendBookingDecisionEmail } from "@/lib/direct-booking-email";

export const runtime = "nodejs";

type Params = Promise<{ requestId: string }>;

const bodySchema = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Answer a renter's change request.
 *
 * Approving a cancellation is the only place in the app that sends
 * money back on purpose, so the amount is the one the renter was
 * quoted when they asked -- not a figure recomputed now, which the
 * closing 48-hour window would have changed underneath them.
 */
export async function PATCH(request: Request, { params }: { params: Params }) {
  const { requestId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const changeRequest = await prisma.bookingChangeRequest.findFirst({
    where: { id: requestId, workspaceId: workspace.id, status: BookingRequestStatus.PENDING },
    include: { order: true },
  });
  if (!changeRequest) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const note = parsed.data.note?.trim() || null;

  if (parsed.data.decision === "DECLINE") {
    await prisma.bookingChangeRequest.update({
      where: { id: changeRequest.id },
      data: {
        status: BookingRequestStatus.DECLINED,
        operatorNote: note,
        resolvedAt: new Date(),
        resolvedBy: user.name,
      },
    });
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "booking_request_declined",
      entityType: "Order",
      entityId: changeRequest.orderId,
      metadata: { requestId: changeRequest.id, kind: changeRequest.kind },
    });
    await emailRenter(changeRequest.order, workspace.id, "declined", note);
    return NextResponse.json({ ok: true });
  }

  if (changeRequest.kind === BookingRequestKind.RESCHEDULE) {
    const { requestedPickupDate, requestedReturnDate } = changeRequest;
    if (!requestedPickupDate || !requestedReturnDate) {
      return NextResponse.json({ error: "DATES_MISSING" }, { status: 400 });
    }

    // A request from before times were asked for was stored as a bare
    // date; it keeps the trip's own times of day rather than becoming
    // a 5am handover.
    const pickupAt = withTripTime(requestedPickupDate, changeRequest.order.pickupDatetime);
    const returnAt = withTripTime(requestedReturnDate, changeRequest.order.returnDatetime);

    // Checked again here, not only when the renter asked: the fleet
    // moves between the two moments, and this is the one that commits.
    const free = await areRequestedDatesFree({
      vehicleId: changeRequest.order.vehicleId,
      excludeOrderId: changeRequest.orderId,
      pickupAt,
      returnAt,
    });
    if (!free) {
      return NextResponse.json({ error: "DATES_UNAVAILABLE" }, { status: 409 });
    }

    const moved = await prisma.order.update({
      where: { id: changeRequest.orderId },
      data: { pickupDatetime: pickupAt, returnDatetime: returnAt },
    });
    await prisma.bookingChangeRequest.update({
      where: { id: changeRequest.id },
      data: {
        status: BookingRequestStatus.APPROVED,
        operatorNote: note,
        resolvedAt: new Date(),
        resolvedBy: user.name,
      },
    });
    await reconcileVehicleConflicts(changeRequest.order.vehicleId);
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "booking_reschedule_approved",
      entityType: "Order",
      entityId: changeRequest.orderId,
      metadata: {
        requestId: changeRequest.id,
        pickupAt: pickupAt.toISOString(),
        returnAt: returnAt.toISOString(),
      },
    });
    await emailRenter(moved, workspace.id, "rescheduled", note);
    return NextResponse.json({ ok: true });
  }

  // Cancellation: the refund the renter was quoted when they asked,
  // not a figure recomputed now, which the closing 48-hour window would
  // have changed underneath them.
  const refundAmount = changeRequest.quotedRefundAmount ?? 0;
  const result = await cancelDirectBookingWithRefund({
    workspaceId: workspace.id,
    orderId: changeRequest.orderId,
    refundAmount,
    actor: user.name,
    idempotencyKey: `booking-request-refund:${changeRequest.id}`,
    note,
    metadata: { tato_request_id: changeRequest.id },
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "REFUND_FAILED" },
      { status: result.error === "STRIPE_NOT_CONFIGURED" ? 503 : 502 },
    );
  }

  await prisma.bookingChangeRequest.update({
    where: { id: changeRequest.id },
    data: {
      status: BookingRequestStatus.APPROVED,
      operatorNote: note,
      refundedAmount: result.refundAmount,
      stripeRefundId: result.stripeRefundId,
      resolvedAt: new Date(),
      resolvedBy: user.name,
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "booking_cancel_approved",
    entityType: "Order",
    entityId: changeRequest.orderId,
    metadata: {
      requestId: changeRequest.id,
      refundAmount: result.refundAmount,
      stripeRefundId: result.stripeRefundId,
    },
  });

  return NextResponse.json({
    ok: true,
    refundAmount: result.refundAmount,
    stripeRefundId: result.stripeRefundId,
  });
}

/** A bare date (a request from before times) takes the trip's own time of day. */
function withTripTime(requested: Date, original: Date) {
  if (!isDateOnlyMoment(requested) || isDateOnlyMoment(original)) return requested;
  return (
    zonedDateTimeToUtc(utcToZonedDate(requested), utcToZonedTime(original)) ?? requested
  );
}

async function emailRenter(
  order: Order,
  workspaceId: string,
  outcome: "rescheduled" | "declined",
  note: string | null,
) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: order.vehicleId },
    select: { brand: true, model: true, year: true },
  });
  if (!vehicle) return;
  await sendBookingDecisionEmail({
    workspaceId,
    order,
    vehicle,
    renterEmail: readDirectBookingPayment(order.sourceMetadata).renterEmail,
    outcome,
    note,
  });
}
