import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/auth";
import { resolveBillingCoupon } from "@/lib/billing";

const couponSchema = z.object({
  code: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = couponSchema.parse(await request.json());
    const resolution = await resolveBillingCoupon(parsed.code);

    return NextResponse.json(resolution);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Coupon validation failed",
      },
      { status: 400 },
    );
  }
}
