import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { DEPOSIT_COLLECTION_METHODS } from "@/lib/direct-booking-deposits";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";
import { roundCurrencyAmount } from "@/lib/utils";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

async function loadOrder(workspaceId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, workspaceId } });
  if (!order) return null;
  const payment = readDirectBookingPayment(order.sourceMetadata);
  return { order, viaStripe: payment.isDirectBooking && Boolean(payment.paymentIntentId) };
}

const detailsSchema = z.object({
  amount: z.number().finite().min(0).max(100_000).optional(),
  collectedVia: z.enum(DEPOSIT_COLLECTION_METHODS).nullable(),
  /** `YYYY-MM-DD`, the operator's calendar day. */
  collectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  refundTo: z.string().trim().max(200).nullable(),
});

/**
 * How a deposit taken in person came in and where it goes back to.
 * Site bookings' deposits are Stripe's to describe, so they are not
 * editable here.
 */
export async function PATCH(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const found = await loadOrder(workspace.id, orderId);
  if (!found) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (found.viaStripe) return NextResponse.json({ error: "STRIPE_DEPOSIT" }, { status: 409 });
  const parsed = detailsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const { amount, collectedVia, collectedOn, refundTo } = parsed.data;
  if (amount !== undefined && found.order.depositSettledAt) {
    return NextResponse.json({ error: "ALREADY_SETTLED" }, { status: 409 });
  }

  const [y, m, d] = (collectedOn ?? "").split("-").map(Number);
  await prisma.order.update({
    where: { id: found.order.id },
    data: {
      ...(amount !== undefined ? { depositAmount: roundCurrencyAmount(amount) } : {}),
      depositCollectedVia: collectedVia,
      // Local noon: the calendar day, whatever the server's clock.
      depositCollectedAt: collectedOn ? new Date(y, m - 1, d, 12) : null,
      depositRefundTo: refundTo || null,
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "deposit_details_updated",
    entityType: "Order",
    entityId: found.order.id,
    metadata: parsed.data,
  });
  return NextResponse.json({ ok: true });
}

const settleSchema = z.object({
  refundAmount: z.number().finite().min(0),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Record that a deposit taken in person was given back (in part or in
 * full). Nothing moves through Stripe; the operator returned it
 * themselves. Site bookings settle through /api/orders/[id]/deposit,
 * which refunds the card.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const found = await loadOrder(workspace.id, orderId);
  if (!found) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (found.viaStripe) return NextResponse.json({ error: "STRIPE_DEPOSIT" }, { status: 409 });
  if (found.order.status === OrderStatus.cancelled) {
    return NextResponse.json({ error: "ORDER_CANCELLED" }, { status: 409 });
  }
  const parsed = settleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const deposit = found.order.depositAmount ?? 0;
  const refundAmount = roundCurrencyAmount(parsed.data.refundAmount) ?? 0;
  if (deposit <= 0) return NextResponse.json({ error: "NO_DEPOSIT" }, { status: 400 });
  if (refundAmount > deposit) return NextResponse.json({ error: "EXCEEDS_DEPOSIT" }, { status: 400 });
  const note = parsed.data.note?.trim() || null;
  // Same rule as a card refund: keeping any of it needs a reason on record.
  if (refundAmount < deposit && !note) return NextResponse.json({ error: "NOTE_REQUIRED" }, { status: 400 });

  const claimed = await prisma.order.updateMany({
    where: { id: found.order.id, depositSettledAt: null },
    data: { depositSettledAt: new Date(), depositRefundedAmount: refundAmount, depositSettlementNote: note },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "ALREADY_SETTLED" }, { status: 409 });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "deposit_settled",
    entityType: "Order",
    entityId: found.order.id,
    metadata: {
      depositAmount: deposit,
      refundAmount,
      keptAmount: roundCurrencyAmount(deposit - refundAmount),
      note,
      method: found.order.depositCollectedVia,
      refundTo: found.order.depositRefundTo,
    },
  });
  return NextResponse.json({ ok: true });
}
