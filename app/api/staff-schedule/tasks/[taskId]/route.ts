import { NextRequest, NextResponse } from "next/server";
import { StaffTaskPriority, StaffTaskStatus } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyStaffTaskAssignment } from "@/lib/staff-task-notifications";

type Params = Promise<{ taskId: string }>;

const taskSchema = z.object({
  staffId: z.string().optional().nullable().or(z.literal("")),
  vehicleId: z.string().optional().nullable().or(z.literal("")),
  orderId: z.string().optional().nullable().or(z.literal("")),
  staffLabel: z.string().trim().optional().nullable().or(z.literal("")),
  vehicleLabel: z.string().trim().optional().nullable().or(z.literal("")),
  orderLabel: z.string().trim().optional().nullable().or(z.literal("")),
  title: z.string().trim().min(2).optional(),
  details: z.string().trim().optional().nullable().or(z.literal("")),
  dueDatetime: z.string().optional().nullable().or(z.literal("")),
  timeWindow: z.string().trim().optional().nullable().or(z.literal("")),
  status: z.nativeEnum(StaffTaskStatus).optional(),
  priority: z.nativeEnum(StaffTaskPriority).optional(),
  category: z.string().trim().optional().nullable().or(z.literal("")),
  sortOrder: z.coerce.number().int().optional(),
});

function nullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function requireTask(workspaceId: string, taskId: string) {
  return prisma.staffTask.findFirst({
    where: { id: taskId, workspaceId },
  });
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
  const staffLabel =
    parsed.staffLabel === undefined ? existing.staffLabel : nullable(parsed.staffLabel);
  const vehicleLabel =
    parsed.vehicleLabel === undefined ? existing.vehicleLabel : nullable(parsed.vehicleLabel);
  const orderLabel =
    parsed.orderLabel === undefined ? existing.orderLabel : nullable(parsed.orderLabel);

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
  const shouldNotifyAssignment = Boolean(staffId && staffId !== existing.staffId);
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
      staffLabel: staffId ? null : staffLabel,
      vehicleLabel: vehicleId ? null : vehicleLabel,
      orderLabel: orderId ? null : orderLabel,
      title: parsed.title ?? existing.title,
      details: parsed.details === undefined ? existing.details : nullable(parsed.details),
      dueDatetime:
        parsed.dueDatetime === undefined ? existing.dueDatetime : parseDate(parsed.dueDatetime),
      timeWindow: parsed.timeWindow === undefined ? existing.timeWindow : nullable(parsed.timeWindow),
      status: nextStatus,
      priority: parsed.priority ?? existing.priority,
      category: parsed.category === undefined ? existing.category : nullable(parsed.category),
      sortOrder: parsed.sortOrder ?? existing.sortOrder,
      completedAt,
    },
    include: taskInclude,
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_updated",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, status: task.status },
  });

  if (shouldNotifyAssignment) {
    await notifyStaffTaskAssignment(task, new URL(request.url).origin);
  }

  return NextResponse.json({ task });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { taskId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireTask(workspace.id, taskId);
  if (!existing) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  await prisma.staffTask.delete({
    where: { id: existing.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_deleted",
    entityType: "StaffTask",
    entityId: existing.id,
    metadata: { title: existing.title, status: existing.status },
  });

  return NextResponse.json({ deletedId: existing.id });
}
