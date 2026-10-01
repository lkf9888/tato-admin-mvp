import { NextResponse } from "next/server";
import { z } from "zod";

import { loadBookingByToken } from "@/lib/booking-access";
import { quoteReschedule } from "@/lib/booking-reschedule";
import { zonedDateTimeToUtc } from "@/lib/booking-time";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

const bodySchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/**
 * What the dates a renter is considering would cost or return, shown
 * before they ask -- so the request they send already says it.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const order = await loadBookingByToken(token);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const pickupAt = zonedDateTimeToUtc(parsed.data.pickupDate, parsed.data.pickupTime);
  const returnAt = zonedDateTimeToUtc(parsed.data.returnDate, parsed.data.returnTime);
  if (!pickupAt || !returnAt || returnAt <= pickupAt) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  const quote = await quoteReschedule({ orderId: order.id, pickupAt, returnAt });
  return NextResponse.json({
    difference: quote.difference,
    settlement: quote.settlement,
    late: quote.late,
  });
}
