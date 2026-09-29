import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { billExtraCharge, quoteExtraCharge } from "@/lib/booking-extra-charge";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

/** What the trip's current times owe beyond what was paid. */
export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const quote = await quoteExtraCharge(workspace.id, orderId);
  if (!quote.ok) {
    return NextResponse.json({ error: quote.reason }, { status: quote.reason === "NOT_FOUND" ? 404 : 400 });
  }
  return NextResponse.json(quote);
}

const bodySchema = z.object({
  method: z.enum(["card", "link"]),
  /** The total the operator saw and confirmed. */
  expectedTotal: z.number().positive(),
});

/** Charge the saved card, or email a payment link. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  try {
    const result = await billExtraCharge({
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
      { error: error instanceof Error ? error.message : "EXTRA_CHARGE_FAILED" },
      { status: 400 },
    );
  }
}
