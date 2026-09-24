import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingRequestKind, BookingRequestStatus, OrderStatus } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { areRequestedDatesFree } from "@/lib/booking-access";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeSecretKey } from "@/lib/stripe";
import { readDirectBookingPayment, refundDirectBookingCharge } from "@/lib/stripe-refunds";
import { dateToDateOnly } from "@/lib/direct-booking";

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
    return NextResponse.json({ ok: true });
  }

  if (changeRequest.kind === BookingRequestKind.RESCHEDULE) {
    const { requestedPickupDate, requestedReturnDate } = changeRequest;
    if (!requestedPickupDate || !requestedReturnDate) {
      return NextResponse.json({ error: "DATES_MISSING" }, { status: 400 });
    }

    // Checked again here, not only when the renter asked: the fleet
    // moves between the two moments, and this is the one that commits.
    const free = await areRequestedDatesFree({
      vehicleId: changeRequest.order.vehicleId,
      excludeOrderId: changeRequest.orderId,
      pickupDate: dateToDateOnly(requestedPickupDate),
      returnDate: dateToDateOnly(requestedReturnDate),
    });
    if (!free) {
      return NextResponse.json({ error: "DATES_UNAVAILABLE" }, { status: 409 });
    }

    await prisma.order.update({
      where: { id: changeRequest.orderId },
      data: { pickupDatetime: requestedPickupDate, returnDatetime: requestedReturnDate },
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
        pickupDate: dateToDateOnly(requestedPickupDate),
        returnDate: dateToDateOnly(requestedReturnDate),
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Cancellation.
  const refundAmount = changeRequest.quotedRefundAmount ?? 0;
  const paymentIntentId = readDirectBookingPayment(changeRequest.order.sourceMetadata).paymentIntentId;
  let stripeRefundId: string | null = null;

  // Refusing beats cancelling silently. A booking marked cancelled
  // while the renter's money sat where it was is the one state nobody
  // can see is wrong from the outside -- not the operator, who sees an
  // approved request, and not the renter, who sees a cancelled trip.
  // An order with no payment intent (typed in by hand, never paid
  // through us) has nothing to send back and passes through.
  if (refundAmount > 0 && paymentIntentId && !getStripeSecretKey()) {
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "booking_cancel_refund_failed",
      entityType: "Order",
      entityId: changeRequest.orderId,
      metadata: { requestId: changeRequest.id, refundAmount, reason: "stripe_not_configured" },
    });
    return NextResponse.json({ error: "REFUND_FAILED" }, { status: 503 });
  }

  if (refundAmount > 0 && paymentIntentId) {
    try {
      // Out of the host's balance, not the platform's, with the
      // platform's fee handed back pro rata: a cancelled trip is one
      // the platform should not be earning on either.
      const refund = await refundDirectBookingCharge({
        paymentIntentId,
        amount: refundAmount,
        refundPlatformFee: true,
        metadata: { tato_request_id: changeRequest.id, tato_order_id: changeRequest.orderId },
        idempotencyKey: `booking-request-refund:${changeRequest.id}`,
      });
      stripeRefundId = refund.id;
    } catch (error) {
      // The trip is NOT cancelled when the money could not move. An
      // order marked cancelled with the renter unpaid-back is the one
      // state nobody can see is wrong from the outside.
      await logActivity({
        workspaceId: workspace.id,
        actor: user.name,
        action: "booking_cancel_refund_failed",
        entityType: "Order",
        entityId: changeRequest.orderId,
        metadata: {
          requestId: changeRequest.id,
          refundAmount,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return NextResponse.json({ error: "REFUND_FAILED" }, { status: 502 });
    }
  }

  await prisma.order.update({
    where: { id: changeRequest.orderId },
    data: { status: OrderStatus.cancelled },
  });
  await prisma.bookingChangeRequest.update({
    where: { id: changeRequest.id },
    data: {
      status: BookingRequestStatus.APPROVED,
      operatorNote: note,
      refundedAmount: stripeRefundId ? refundAmount : 0,
      stripeRefundId,
      resolvedAt: new Date(),
      resolvedBy: user.name,
    },
  });
  await reconcileVehicleConflicts(changeRequest.order.vehicleId);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "booking_cancel_approved",
    entityType: "Order",
    entityId: changeRequest.orderId,
    metadata: { requestId: changeRequest.id, refundAmount, stripeRefundId },
  });

  return NextResponse.json({ ok: true, refundAmount, stripeRefundId });
}
