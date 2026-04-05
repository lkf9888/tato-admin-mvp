import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/auth";
import { createBillingCheckoutUrl } from "@/lib/billing";

const checkoutSchema = z.object({
  desiredPaidVehicleSlots: z.coerce.number().int().min(1).max(500),
});

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = checkoutSchema.parse(await request.json());
    const url = await createBillingCheckoutUrl({
      desiredPaidVehicleSlots: parsed.desiredPaidVehicleSlots,
      origin: new URL(request.url).origin,
    });

    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Checkout failed",
      },
      { status: 400 },
    );
  }
}
