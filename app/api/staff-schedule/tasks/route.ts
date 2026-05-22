import { NextRequest, NextResponse } from "next/server";
import { StaffTaskPriority, StaffTaskStatus } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const taskSchema = z.object({
  staffId: z.string().optional().or(z.literal("")),
  vehicleId: z.string().optional().or(z.literal("")),
  orderId: z.string().optional().or(z.literal("")),
  staffLabel: z.string().trim().optional().or(z.literal("")),
  vehicleLabel: z.string().trim().optional().or(z.literal("")),
  orderLabel: z.string().trim().optional().or(z.literal("")),
  title: z.string().trim().min(2),
  details: z.string().trim().optional().or(z.literal("")),
  dueDatetime: z.string().optional().or(z.literal("")),
  timeWindow: z.string().trim().optional().or(z.literal("")),
  status: z.nativeEnum(StaffTaskStatus).optional(),
  priority: z.nativeEnum(StaffTaskPriority).optional(),
  category: z.string().trim().optional().or(z.literal("")),
});

function nullable(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const taskInclude = {
  staff: true,
  vehicle: { select: { id: true, plateNumber: true, nickname: true } },
  order: { select: { id: true, renterName: true, pickupDatetime: true, returnDatetime: true } },
  attachments: {
    where: { isArchived: false },
    orderBy: { uploadedAt: "asc" as const },
  },
};

async function ensureWorkspaceRefs(input: {
  workspaceId: string;
  staffId?: string | null;
  vehicleId?: string | null;
  orderId?: string | null;
}) {
  const [staff, vehicle, order] = await Promise.all([
    input.staffId
      ? prisma.staffMember.findFirst({
          where: { id: input.staffId, workspaceId: input.workspaceId, isActive: true },
          select: { id: true },
        })
      : null,
    input.vehicleId
      ? prisma.vehicle.findFirst({
          where: { id: input.vehicleId, workspaceId: input.workspaceId },
          select: { id: true },
        })
      : null,
    input.orderId
      ? prisma.order.findFirst({
          where: { id: input.orderId, workspaceId: input.workspaceId },
          select: { id: true },
        })
      : null,
  ]);

  if (input.staffId && !staff) return "STAFF_NOT_FOUND";
  if (input.vehicleId && !vehicle) return "VEHICLE_NOT_FOUND";
  if (input.orderId && !order) return "ORDER_NOT_FOUND";
  return null;
}

export async function POST(request: NextRequest) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = taskSchema.parse(await request.json());
  const staffId = nullable(parsed.staffId);
  const vehicleId = nullable(parsed.vehicleId);
  const orderId = nullable(parsed.orderId);

  const refError = await ensureWorkspaceRefs({
    workspaceId: workspace.id,
    staffId,
    vehicleId,
    orderId,
  });
  if (refError) {
    return NextResponse.json({ error: refError }, { status: 400 });
  }

  const task = await prisma.staffTask.create({
    data: {
      workspaceId: workspace.id,
      staffId,
      vehicleId,
      orderId,
      staffLabel: staffId ? null : nullable(parsed.staffLabel),
      vehicleLabel: vehicleId ? null : nullable(parsed.vehicleLabel),
      orderLabel: orderId ? null : nullable(parsed.orderLabel),
      title: parsed.title,
      details: nullable(parsed.details),
      dueDatetime: parseDate(parsed.dueDatetime),
      timeWindow: nullable(parsed.timeWindow),
      status: parsed.status ?? StaffTaskStatus.todo,
      priority: parsed.priority ?? StaffTaskPriority.normal,
      category: nullable(parsed.category),
    },
    include: taskInclude,
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_created",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, staffId: task.staffId, vehicleId: task.vehicleId },
  });

  return NextResponse.json({ task });
}
