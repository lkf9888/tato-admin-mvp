import { NextRequest, NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { getAmountsPaid, loadBookingById, quoteCancellation } from "@/lib/booking-access";
import { cancelDirectBookingWithRefund } from "@/lib/direct-booking-cancel";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

/**
 * The operator cancelling a direct booking themselves -- a call from
 * the renter, a no-show, a car off the road. What the policy would give
 * back, and what was paid, so the operator can choose.
 */
export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const order = await loadBookingById(workspace.id, orderId);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const payment = readDirectBookingPayment(order.sourceMetadata);
  if (!payment.isDirectBooking) return NextResponse.json({ error: "NOT_DIRECT_BOOKING" }, { status: 400 });

  const { paidAmount, depositAmount } = getAmountsPaid(order);
  const quote = await quoteCancellation(order);
  return NextResponse.json({
    isCancelled: order.status === OrderStatus.cancelled,
    paidAmount,
    depositAmount,
    policyRefund: quote.refundAmount,
    outcome: quote.outcome,
    canRefund: Boolean(payment.paymentIntentId),
    renterEmail: payment.renterEmail,
  });
}

const bodySchema = z.object({
  refundAmount: z.number().min(0).max(100_000),
  /** Also remove it (the app's delete); otherwise it stays as a cancelled strip. */
  archive: z.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const order = await loadBookingById(workspace.id, orderId);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (order.status === OrderStatus.cancelled) {
    return NextResponse.json({ error: "ALREADY_CANCELLED" }, { status: 409 });
  }
  // Never more than the card took: Stripe would refuse it anyway, and
  // saying so here is clearer than its error.
  const { paidAmount } = getAmountsPaid(order);
  if (parsed.data.refundAmount > paidAmount + 0.001) {
    return NextResponse.json({ error: "REFUND_TOO_LARGE" }, { status: 400 });
  }

  const result = await cancelDirectBookingWithRefund({
    workspaceId: workspace.id,
    orderId,
    refundAmount: parsed.data.refundAmount,
    actor: user.name,
    idempotencyKey: `operator-cancel:${orderId}:${Math.round(parsed.data.refundAmount * 100)}`,
    archive: parsed.data.archive,
    note: parsed.data.note || null,
    metadata: { tato_cancelled_by: "operator" },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, detail: result.detail }, { status: 502 });
  }
  return NextResponse.json(result);
}
