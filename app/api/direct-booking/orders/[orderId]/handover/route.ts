import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  isHandoverStage,
  loadHandovers,
  saveOperatorReadings,
  storeHandoverPhoto,
  summarizeMileage,
} from "@/lib/direct-booking-handover";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

async function loadOrder(workspaceId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId },
    include: { vehicle: true },
  });
  if (!order || !order.vehicle || !readDirectBookingPayment(order.sourceMetadata).isDirectBooking) {
    return null;
  }
  return order;
}

function bookedDays(sourceMetadata: string | null) {
  try {
    const value = Number((JSON.parse(sourceMetadata ?? "{}") as { bookedDays?: unknown }).bookedDays);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Both sides of both handovers, and the distance driven once both readings exist. */
export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const order = await loadOrder(workspace.id, orderId);
  if (!order) return NextResponse.json({ error: "NOT_DIRECT_BOOKING" }, { status: 404 });
  const view = await loadHandovers(order.id);
  const mileage = await summarizeMileage({
    view,
    vehicle: order.vehicle!,
    chargedDays: bookedDays(order.sourceMetadata),
  });
  return NextResponse.json({ ...view, mileage });
}

/** One operator photo. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const order = await loadOrder(workspace.id, orderId);
  if (!order) return NextResponse.json({ error: "NOT_DIRECT_BOOKING" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  const stage = formData?.get("stage");
  const file = formData?.get("file");
  if (!isHandoverStage(stage) || !(file instanceof File)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const result = await storeHandoverPhoto({
    workspaceId: workspace.id,
    orderId: order.id,
    stage,
    party: "operator",
    file,
    uploadedBy: user.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.photo);
}

const readingsSchema = z.object({
  stage: z.enum(["pickup", "return"]),
  odometerKm: z.number().int().min(0).max(2_000_000).nullable(),
  fuelLevel: z.string().trim().max(20).nullable(),
  note: z.string().trim().max(1000).nullable(),
});

/** The operator's odometer, fuel and note for one handover. */
export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const order = await loadOrder(workspace.id, orderId);
  if (!order) return NextResponse.json({ error: "NOT_DIRECT_BOOKING" }, { status: 404 });
  const parsed = readingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  await saveOperatorReadings({
    workspaceId: workspace.id,
    orderId: order.id,
    stage: parsed.data.stage,
    odometerKm: parsed.data.odometerKm,
    fuelLevel: parsed.data.fuelLevel || null,
    note: parsed.data.note || null,
    updatedBy: user.name,
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "handover_readings_saved",
    entityType: "Order",
    entityId: order.id,
    metadata: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
