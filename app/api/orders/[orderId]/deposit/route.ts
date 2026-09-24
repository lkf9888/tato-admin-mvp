import { NextResponse } from "next/server";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { sendDepositSettlementEmail } from "@/lib/direct-booking-email";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeSecretKey } from "@/lib/stripe";
import { readDirectBookingPayment, refundDirectBookingCharge } from "@/lib/stripe-refunds";
import { roundCurrencyAmount } from "@/lib/utils";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

const bodySchema = z.object({
  /** Dollars going back to the renter. 0 keeps the whole deposit. */
  refundAmount: z.number().finite().min(0),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Settle a direct booking's security deposit, once.
 *
 * The deposit was charged with the rent -- a real charge, not a hold,
 * because a hold expires in about a week and trips here run longer.
 * So giving it back is a refund, and deciding how much is the
 * operator's call after the car is back. Nothing here is automatic.
 *
 * Claim first, then Stripe. The row is marked settled in a conditional
 * update before any money moves, so a second click, a second tab or a
 * retried request finds nothing to claim. If Stripe refuses, the claim
 * is released and the operator sees the error; if the process dies
 * between Stripe succeeding and the refund id being written, the order
 * still reads as settled, which is the true state of the money.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id },
    include: { vehicle: { select: { brand: true, model: true, year: true } } },
  });
  if (!order) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const payment = readDirectBookingPayment(order.sourceMetadata);
  const deposit = order.depositAmount ?? 0;
  if (!payment.isDirectBooking || !payment.paymentIntentId || deposit <= 0) {
    return NextResponse.json({ error: "NO_DEPOSIT" }, { status: 400 });
  }
  // An approved cancellation refunds the deposit with everything else,
  // so there is nothing left on the charge to settle.
  if (order.status === OrderStatus.cancelled) {
    return NextResponse.json({ error: "ORDER_CANCELLED" }, { status: 409 });
  }

  const refundAmount = roundCurrencyAmount(parsed.data.refundAmount) ?? 0;
  if (refundAmount > deposit) {
    return NextResponse.json({ error: "EXCEEDS_DEPOSIT" }, { status: 400 });
  }
  const note = parsed.data.note?.trim() || null;
  // Keeping any of someone's deposit without saying why is the version
  // of this that ends in a chargeback.
  if (refundAmount < deposit && !note) {
    return NextResponse.json({ error: "NOTE_REQUIRED" }, { status: 400 });
  }
  if (refundAmount > 0 && !getStripeSecretKey()) {
    return NextResponse.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
  }

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, depositSettledAt: null },
    data: {
      depositSettledAt: new Date(),
      depositRefundedAmount: refundAmount,
      depositSettlementNote: note,
    },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "ALREADY_SETTLED" }, { status: 409 });
  }

  let stripeRefundId: string | null = null;
  if (refundAmount > 0) {
    try {
      // The deposit was never in the platform's fee base, so none of
      // the fee goes back -- and all of the refund comes out of the
      // host's balance, which is where the deposit went.
      const refund = await refundDirectBookingCharge({
        paymentIntentId: payment.paymentIntentId,
        amount: refundAmount,
        refundPlatformFee: false,
        metadata: { tato_order_id: order.id, tato_kind: "deposit" },
        idempotencyKey: `deposit-refund:${order.id}`,
      });
      stripeRefundId = refund.id;
    } catch (error) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          depositSettledAt: null,
          depositRefundedAmount: null,
          depositSettlementNote: null,
        },
      });
      const message = error instanceof Error ? error.message : String(error);
      await logActivity({
        workspaceId: workspace.id,
        actor: user.name,
        action: "deposit_refund_failed",
        entityType: "Order",
        entityId: order.id,
        metadata: { refundAmount, error: message },
      });
      return NextResponse.json({ error: "REFUND_FAILED", detail: message }, { status: 502 });
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { depositStripeRefundId: stripeRefundId },
    });
  }

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "deposit_settled",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      depositAmount: deposit,
      refundAmount,
      keptAmount: roundCurrencyAmount(deposit - refundAmount),
      note,
      stripeRefundId,
    },
  });

  const email = await sendDepositSettlementEmail({
    workspaceId: workspace.id,
    order,
    vehicle: order.vehicle,
    renterEmail: payment.renterEmail,
    refundedAmount: refundAmount,
    note,
  });

  return NextResponse.json({ ok: true, refundAmount, stripeRefundId, emailSent: email.ok });
}
