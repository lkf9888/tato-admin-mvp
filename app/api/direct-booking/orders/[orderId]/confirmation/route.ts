import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { sendDirectBookingConfirmationEmail } from "@/lib/direct-booking-email";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

/**
 * Send a direct booking's confirmation email again.
 *
 * The webhook sends it once, and a failure there -- an unverified
 * sending domain, say -- used to leave the renter with no confirmation
 * and no way to get one. The same function builds it, from the same
 * template, so a resent email is the one they should have had.
 */
export async function POST(_request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id },
    include: {
      vehicle: {
        select: { nickname: true, brand: true, model: true, year: true, plateNumber: true },
      },
    },
  });
  if (!order || !order.vehicle) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const payment = readDirectBookingPayment(order.sourceMetadata);
  if (!payment.isDirectBooking) {
    return NextResponse.json({ error: "NOT_DIRECT_BOOKING" }, { status: 400 });
  }
  if (!payment.renterEmail) {
    return NextResponse.json({ error: "NO_RENTER_EMAIL" }, { status: 400 });
  }

  const result = await sendDirectBookingConfirmationEmail({
    workspaceId: workspace.id,
    order,
    vehicle: order.vehicle,
    renterEmail: payment.renterEmail,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "SEND_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to: payment.renterEmail });
}
