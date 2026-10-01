import { NextResponse } from "next/server";
import { OrderStatus } from "@prisma/client";

import { loadBookingByToken } from "@/lib/booking-access";
import {
  isHandoverStage,
  loadHandovers,
  storeHandoverPhoto,
} from "@/lib/direct-booking-handover";
import { logActivity } from "@/lib/orders";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

/** The renter's own handover photos, pickup and return. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const order = await loadBookingByToken(token);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const view = await loadHandovers(order.id);
  return NextResponse.json({
    pickup: view.pickup.renter,
    return: view.return.renter,
  });
}

/**
 * One photo from the renter, at pickup or at return. The return stage
 * opens once the trip has started; a cancelled booking takes none.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const order = await loadBookingByToken(token);
  if (!order || !order.workspaceId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (order.status === OrderStatus.cancelled) {
    return NextResponse.json({ error: "BOOKING_CANCELLED" }, { status: 409 });
  }

  const formData = await request.formData().catch(() => null);
  const stage = formData?.get("stage");
  const file = formData?.get("file");
  if (!isHandoverStage(stage) || !(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  // Return photos make sense only once the car has been collected; an
  // hour's slack lets a renter who picked up early start right away.
  if (stage === "return" && Date.now() < order.pickupDatetime.getTime() - 60 * 60_000) {
    return NextResponse.json({ error: "RETURN_NOT_OPEN" }, { status: 409 });
  }

  const result = await storeHandoverPhoto({
    workspaceId: order.workspaceId,
    orderId: order.id,
    stage,
    party: "renter",
    file,
    uploadedBy: order.renterName,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await logActivity({
    workspaceId: order.workspaceId,
    actor: order.renterName,
    action: "handover_photo_uploaded",
    entityType: "Order",
    entityId: order.id,
    metadata: { stage, party: "renter", photoId: result.photo.id },
  });
  return NextResponse.json(result.photo);
}
