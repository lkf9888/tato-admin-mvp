import { NextResponse } from "next/server";

import { handoverInputSchema, saveOrderHandover } from "@/lib/order-handover";
import { findSharedStaffTask } from "@/lib/staff-share";

type Params = Promise<{ token: string; taskId: string }>;

/**
 * A staff member records where they left the car, or where they found
 * it, from their own task page: the spots and the note on the order the
 * task belongs to. Only their own task, and only one attached to a
 * trip. The task page's token is the authorisation, as for everything
 * else on it.
 */
export async function PUT(request: Request, { params }: { params: Params }) {
  const { token, taskId } = await params;
  const found = await findSharedStaffTask(token, taskId);
  if (!found?.task.orderId || !found.staff.workspaceId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const parsed = handoverInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const spots = await saveOrderHandover({
    orderId: found.task.orderId,
    workspaceId: found.staff.workspaceId,
    actor: `staff:${found.staff.name}`,
    values: parsed.data,
  });
  return NextResponse.json({ spots });
}
