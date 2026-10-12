import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * Who hands one trip's car over: its pickup and return tasks on the
 * staff schedule, each with the person it is assigned to. For the
 * calendar's card on a phone, which says "delivery: Steven" or "nobody
 * assigned yet" without opening the schedule.
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
    select: { id: true },
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
  return NextResponse.json({ pickup: pick("order_pickup"), return: pick("order_return") });
}
