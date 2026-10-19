import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import { handoverInputSchema, saveOrderHandover } from "@/lib/order-handover";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * One trip's handover: who does each one (its pickup and return tasks
 * on the staff schedule, each with the person it is assigned to) and
 * where (the spots and the note, lib/order-handover.ts). GET for the
 * calendar's card on a phone; PUT saves the spots and note.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, vehicleIds } = await requireAccessContext();
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      workspaceId: workspace.id,
      ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}),
    },
    select: { id: true, pickupSpot: true, returnSpot: true, handoverNote: true },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const tasks = await prisma.staffTask.findMany({
    where: {
      orderId,
      workspaceId: workspace.id,
      category: { in: ["order_pickup", "order_return"] },
      status: { not: "cancelled" },
      parentTaskId: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      category: true,
      status: true,
      dueDatetime: true,
      staff: { select: { id: true, name: true, color: true } },
    },
  });

  const pick = (category: string) => {
    const task = tasks.find((item) => item.category === category);
    return task
      ? {
          taskId: task.id,
          status: task.status,
          staff: task.staff ? { id: task.staff.id, name: task.staff.name, color: task.staff.color } : null,
        }
      : null;
  };
  return NextResponse.json({
    pickup: pick("order_pickup"),
    return: pick("order_return"),
    spots: { pickupSpot: order.pickupSpot, returnSpot: order.returnSpot, handoverNote: order.handoverNote },
  });
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      workspaceId: workspace.id,
      ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}),
    },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const parsed = handoverInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const spots = await saveOrderHandover({
    orderId,
    workspaceId: workspace.id,
    actor: user.name,
    values: parsed.data,
  });
  return NextResponse.json({ spots });
}
