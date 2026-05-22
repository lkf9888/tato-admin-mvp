import { NextRequest, NextResponse } from "next/server";
import { StaffTaskPriority, StaffTaskStatus } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ taskId: string }>;

const taskSchema = z.object({
  staffId: z.string().optional().nullable().or(z.literal("")),
  vehicleId: z.string().optional().nullable().or(z.literal("")),
  orderId: z.string().optional().nullable().or(z.literal("")),
  title: z.string().trim().min(2).optional(),
  details: z.string().trim().optional().nullable().or(z.literal("")),
  dueDatetime: z.string().optional().nullable().or(z.literal("")),
  timeWindow: z.string().trim().optional().nullable().or(z.literal("")),
  status: z.nativeEnum(StaffTaskStatus).optional(),
  priority: z.nativeEnum(StaffTaskPriority).optional(),
  category: z.string().trim().optional().nullable().or(z.literal("")),
});

function nullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function requireTask(workspaceId: string, taskId: string) {
  return prisma.staffTask.findFirst({
    where: { id: taskId, workspaceId },
  });
}

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

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { taskId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireTask(workspace.id, taskId);
  if (!existing) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const parsed = taskSchema.parse(await request.json());
  const staffId = parsed.staffId === undefined ? existing.staffId : nullable(parsed.staffId);
  const vehicleId = parsed.vehicleId === undefined ? existing.vehicleId : nullable(parsed.vehicleId);
  const orderId = parsed.orderId === undefined ? existing.orderId : nullable(parsed.orderId);

  const refError = await ensureWorkspaceRefs({
    workspaceId: workspace.id,
    staffId,
    vehicleId,
    orderId,
  });
  if (refError) {
    return NextResponse.json({ error: refError }, { status: 400 });
  }

  const nextStatus = parsed.status ?? existing.status;
  const completedAt =
    nextStatus === StaffTaskStatus.done
      ? existing.completedAt ?? new Date()
      : nextStatus === StaffTaskStatus.cancelled
        ? existing.completedAt
        : null;

  const task = await prisma.staffTask.update({
    where: { id: existing.id },
    data: {
      staffId,
      vehicleId,
      orderId,
      title: parsed.title ?? existing.title,
      details: parsed.details === undefined ? existing.details : nullable(parsed.details),
      dueDatetime:
        parsed.dueDatetime === undefined ? existing.dueDatetime : parseDate(parsed.dueDatetime),
      timeWindow: parsed.timeWindow === undefined ? existing.timeWindow : nullable(parsed.timeWindow),
      status: nextStatus,
      priority: parsed.priority ?? existing.priority,
      category: parsed.category === undefined ? existing.category : nullable(parsed.category),
      completedAt,
    },
    include: {
      staff: true,
      vehicle: { select: { id: true, plateNumber: true, nickname: true } },
      order: { select: { id: true, renterName: true, pickupDatetime: true, returnDatetime: true } },
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_updated",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, status: task.status },
  });

  return NextResponse.json({ task });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { taskId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireTask(workspace.id, taskId);
  if (!existing) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const task = await prisma.staffTask.update({
    where: { id: existing.id },
    data: { status: StaffTaskStatus.cancelled },
    include: {
      staff: true,
      vehicle: { select: { id: true, plateNumber: true, nickname: true } },
      order: { select: { id: true, renterName: true, pickupDatetime: true, returnDatetime: true } },
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_cancelled",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title },
  });

  return NextResponse.json({ task });
}
