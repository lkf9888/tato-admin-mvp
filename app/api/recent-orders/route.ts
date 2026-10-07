import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import { rememberOrderView } from "@/lib/recent-orders";

/**
 * Note that the signed-in person opened an order (sent with
 * navigator.sendBeacon as they click through). Outside every section on
 * purpose: anyone who can open an order may note it, and the order is
 * checked against their workspace and cars here.
 */
export async function POST(request: Request) {
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  if (!orderId) return NextResponse.json({ error: "MISSING_ID" }, { status: 400 });
  await rememberOrderView({ workspaceId: workspace.id, userId: user.id, orderId, vehicleIds });
  return NextResponse.json({ ok: true });
}
