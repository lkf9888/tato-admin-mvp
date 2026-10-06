import "server-only";

import { chargeOrder, priceTrip, readMetadata, type ExtraChargeResult } from "@/lib/booking-extra-charge";
import { isPastFreeCancellation } from "@/lib/booking-changes";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { logActivity } from "@/lib/orders";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment, refundDirectBookingCharge } from "@/lib/stripe-refunds";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * What moving a trip costs or returns.
 *
 * The difference between the trip as booked and as asked for, both at
 * today's prices. A dearer trip owes the difference. A cheaper one gets
 * it back when asked before the cancellation policy's free deadline,
 * as a free cancellation would; past it the shortened part is kept, as
 * a late cancellation keeps rent.
 */
export async function quoteReschedule(input: {
  orderId: string;
  pickupAt: Date;
  returnAt: Date;
  now?: Date;
}) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: { vehicle: true },
  });
  if (!order.vehicle) throw new Error("Order has no vehicle.");
  const now = input.now ?? new Date();
  const [current, next, policy] = await Promise.all([
    priceTrip({ sourceMetadata: order.sourceMetadata, vehicle: order.vehicle }, order.pickupDatetime, order.returnDatetime),
    priceTrip({ sourceMetadata: order.sourceMetadata, vehicle: order.vehicle }, input.pickupAt, input.returnAt),
    getBookingPolicyForVehicle(order.vehicle),
  ]);
  const difference = roundMoney(next.total - current.total);
  const late = isPastFreeCancellation(policy.cancellationPolicy, order.pickupDatetime, now);
  const settlement = difference > 0 ? difference : late ? 0 : difference;
  return {
    difference,
    settlement,
    late,
    newDays: next.days,
    /** The pre-tax part of the difference, which the commission is on. */
    beforeTaxDifference: roundMoney(next.beforeTax - current.beforeTax),
  };
}

export type RescheduleSettlement =
  | { kind: "none" }
  | { kind: "charged"; result: ExtraChargeResult }
  | { kind: "refunded"; amount: number; stripeRefundId: string | null }
  | { kind: "refund_failed"; amount: number; error: string };

/**
 * After an approved move: charge the difference the renter was quoted,
 * or refund it, and reset what the booking counts as paid for so the
 * extra-days bill starts from the new trip.
 */
export async function settleReschedule(input: {
  workspaceId: string;
  orderId: string;
  requestId: string;
  /** As quoted when the renter asked; null on requests from before v1.29.0. */
  settlement: number | null;
  actor: string;
}): Promise<RescheduleSettlement> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: { vehicle: true },
  });
  if (input.settlement == null) return { kind: "none" };
  const settlement = roundMoney(input.settlement);

  if (settlement > 0) {
    const quote = await quoteReschedule({
      orderId: order.id,
      pickupAt: order.pickupDatetime,
      returnAt: order.returnDatetime,
    }).catch(() => null);
    // Commission on the pre-tax share of what is charged.
    const ratio = quote && quote.difference > 0 ? quote.beforeTaxDifference / quote.difference : 1;
    const result: ExtraChargeResult = await chargeOrder({
      workspaceId: input.workspaceId,
      orderId: order.id,
      lines: [{ label: "Date change", amount: settlement }],
      total: settlement,
      commissionBase: roundMoney(Math.min(settlement, Math.max(0, settlement * ratio))),
      method: "card",
      actor: input.actor,
      reason: { kind: "reschedule" },
      idempotencyBase: `reschedule:${input.requestId}`,
    }).catch((error) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
    // Only a difference that was charged (or asked for by link) makes
    // the new length the paid one; otherwise the extra-days bill must
    // still be able to see the gap.
    if (result.ok) await markPaidLength(order.id);
    return { kind: "charged", result };
  }

  if (settlement === 0) {
    await markPaidLength(order.id);
    return { kind: "none" };
  }

  const amount = -settlement;
  const payment = readDirectBookingPayment(order.sourceMetadata);
  if (!payment.paymentIntentId) {
    await markPaidLength(order.id);
    return { kind: "none" };
  }
  try {
    const refund = await refundDirectBookingCharge({
      paymentIntentId: payment.paymentIntentId,
      amount,
      refundPlatformFee: true,
      metadata: { tato_order_id: order.id, tato_request_id: input.requestId, reason: "reschedule" },
      idempotencyKey: `reschedule-refund:${input.requestId}`,
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { totalPrice: roundMoney((order.totalPrice ?? 0) - amount) },
    });
    await syncOrderOwnerLedger(order.id);
    await markPaidLength(order.id);
    await logActivity({
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: "booking_reschedule_refunded",
      entityType: "Order",
      entityId: order.id,
      metadata: { amount, stripeRefundId: refund.id, requestId: input.requestId },
    });
    return { kind: "refunded", amount, stripeRefundId: refund.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logActivity({
      workspaceId: input.workspaceId,
      actor: input.actor,
      action: "booking_reschedule_refund_failed",
      entityType: "Order",
      entityId: order.id,
      metadata: { amount, error: message, requestId: input.requestId },
    });
    return { kind: "refund_failed", amount, error: message };
  }
}

/**
 * The booking now counts as paid for its new length (less extra days
 * billed separately, which stand on their own), so the extra-days bill
 * starts from the moved trip.
 */
async function markPaidLength(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vehicle: true } });
  if (!order?.vehicle) return;
  const metadata = readMetadata(order.sourceMetadata);
  const trip = await priceTrip(
    { sourceMetadata: order.sourceMetadata, vehicle: order.vehicle },
    order.pickupDatetime,
    order.returnDatetime,
  );
  const separatelyBilled = (metadata.extraCharges ?? [])
    .filter((charge) => (charge.kind ?? "days") === "days")
    .reduce((sum, charge) => sum + charge.days, 0);
  metadata.bookedDays = Math.max(1, trip.days - separatelyBilled);
  await prisma.order.update({ where: { id: order.id }, data: { sourceMetadata: JSON.stringify(metadata) } });
}
