import "server-only";

import { OrderStatus } from "@prisma/client";

import { sendBookingDecisionEmail } from "@/lib/direct-booking-email";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeSecretKey } from "@/lib/stripe";
import { readDirectBookingPayment, refundDirectBookingCharge } from "@/lib/stripe-refunds";

/**
 * Cancel a direct booking and send back what is due -- the one path
 * for it, whether the renter asked (and the operator approved) or the
 * operator cancelled it themselves.
 *
 * The refund goes first and the trip is only cancelled once the money
 * has moved: an order marked cancelled with the renter unpaid-back is
 * the one state nobody can see is wrong from the outside. An order
 * with no payment intent (typed in by hand) has nothing to send back.
 *
 * `archive` also removes the order (the app's "delete": archived AND
 * cancelled); without it the trip stays on the calendar as a thin strip.
 */
export async function cancelDirectBookingWithRefund(input: {
  workspaceId: string;
  orderId: string;
  refundAmount: number;
  actor: string;
  /** Keys the Stripe refund, so a retry cannot refund twice. */
  idempotencyKey: string;
  archive?: boolean;
  note?: string | null;
  metadata?: Record<string, string>;
}): Promise<
  | { ok: true; refundAmount: number; stripeRefundId: string | null; emailed: boolean }
  | { ok: false; error: "NOT_FOUND" | "REFUND_FAILED" | "STRIPE_NOT_CONFIGURED"; detail?: string }
> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, workspaceId: input.workspaceId },
    include: { vehicle: { select: { brand: true, model: true, year: true } } },
  });
  if (!order || !order.vehicle) return { ok: false, error: "NOT_FOUND" };

  const payment = readDirectBookingPayment(order.sourceMetadata);
  const refundAmount = Math.max(0, Math.round(input.refundAmount * 100) / 100);
  let stripeRefundId: string | null = null;

  if (refundAmount > 0 && payment.paymentIntentId) {
    if (!getStripeSecretKey()) return { ok: false, error: "STRIPE_NOT_CONFIGURED" };
    try {
      // Out of the host's balance, with the platform's commission
      // handed back pro rata: a cancelled trip is one the platform
      // should not be earning on either.
      const refund = await refundDirectBookingCharge({
        paymentIntentId: payment.paymentIntentId,
        amount: refundAmount,
        refundPlatformFee: true,
        metadata: { tato_order_id: order.id, ...(input.metadata ?? {}) },
        idempotencyKey: input.idempotencyKey,
      });
      stripeRefundId = refund.id;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await logActivity({
        workspaceId: input.workspaceId,
        actor: input.actor,
        action: "booking_cancel_refund_failed",
        entityType: "Order",
        entityId: order.id,
        metadata: { refundAmount, error: detail, ...(input.metadata ?? {}) },
      });
      return { ok: false, error: "REFUND_FAILED", detail };
    }
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.cancelled, ...(input.archive ? { isArchived: true } : {}) },
  });
  await reconcileVehicleConflicts(order.vehicleId);
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "direct_booking_cancelled",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      refundAmount: stripeRefundId ? refundAmount : 0,
      stripeRefundId,
      archived: Boolean(input.archive),
      ...(input.metadata ?? {}),
    },
  });

  const email = await sendBookingDecisionEmail({
    workspaceId: input.workspaceId,
    order,
    vehicle: order.vehicle,
    renterEmail: payment.renterEmail,
    outcome: "cancelled",
    refundAmount: stripeRefundId ? refundAmount : 0,
    note: input.note ?? null,
  });

  return {
    ok: true,
    refundAmount: stripeRefundId ? refundAmount : 0,
    stripeRefundId,
    emailed: email.ok,
  };
}
