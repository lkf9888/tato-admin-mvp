import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { billMileageCharge } from "@/lib/direct-booking-handover";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

const bodySchema = z.object({
  method: z.enum(["card", "link"]),
  /** The total the operator saw and confirmed. */
  expectedTotal: z.number().positive(),
});

/** Bill the excess distance: the saved card, or a payment link by email. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  try {
    const result = await billMileageCharge({
      workspaceId: workspace.id,
      orderId,
      method: parsed.data.method,
      expectedTotal: parsed.data.expectedTotal,
      actor: user.name,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MILEAGE_CHARGE_FAILED" },
      { status: 400 },
    );
  }
}
