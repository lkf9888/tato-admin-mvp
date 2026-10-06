import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { markOrdersPayment } from "@/lib/orders-list";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["paid", "unpaid"]),
});

/** Bulk "paid" / "unpaid" from the orders list; the rules are in markOrdersPayment. */
export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const { updated, skipped } = await markOrdersPayment({
    workspaceId: workspace.id,
    ids: parsed.data.ids,
    action: parsed.data.action,
    actor: user.name,
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: parsed.data.action === "paid" ? "orders_bulk_marked_paid" : "orders_bulk_marked_unpaid",
    entityType: "Order",
    entityId: parsed.data.ids[0],
    metadata: { count: parsed.data.ids.length, updated, skipped },
  });
  revalidatePath("/orders");
  return NextResponse.json({ updated, skipped });
}
