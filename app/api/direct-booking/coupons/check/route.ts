import { NextResponse } from "next/server";
import { z } from "zod";

import { checkCoupon } from "@/lib/booking-coupons-server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp, recordFailedAttempt } from "@/lib/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  vehicleId: z.string().min(1).max(60),
  code: z.string().trim().min(1).max(40),
});

const LIMIT = { scope: "coupon_check_ip", maxAttempts: 10, windowMs: 15 * 60_000 };

/**
 * A renter's "Apply" on a coupon code: whether it is good for this
 * car's operator, and what it takes off. Only a check -- checkout checks
 * again and holds the code. Wrong guesses are counted per IP, so the
 * code space cannot be walked.
 */
export async function POST(request: Request) {
  const identifier = await getClientIp();
  const decision = await checkRateLimit({ ...LIMIT, identifier });
  if (!decision.allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "not_found" }, { status: 400 });

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: parsed.data.vehicleId },
    select: { workspaceId: true, directBookingEnabled: true, isArchived: true },
  });
  if (!vehicle?.workspaceId || vehicle.isArchived || !vehicle.directBookingEnabled) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }

  const result = await checkCoupon(vehicle.workspaceId, parsed.data.code);
  if (!result.ok) {
    await recordFailedAttempt({ scope: LIMIT.scope, identifier, windowMs: LIMIT.windowMs });
    return NextResponse.json({ ok: false, reason: result.reason });
  }
  const { code, kind, value } = result.coupon;
  return NextResponse.json({ ok: true, coupon: { code, kind, value } });
}
