import { NextRequest, NextResponse } from "next/server";
import { StaffTaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { findSharedStaffTask, serializeStaffShareTask, staffShareTaskInclude } from "@/lib/staff-share";
import { notifyAdminsOfStaffTaskAction } from "@/lib/staff-task-notifications";

type Params = Promise<{ token: string; taskId: string }>;

const taskPatchSchema = z.object({
  title: z.string().trim().min(1).optional(),
  details: z.string().trim().optional().nullable().or(z.literal("")),
  dueDatetime: z.string().optional().nullable().or(z.literal("")),
  timeWindow: z.string().trim().optional().nullable().or(z.literal("")),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  unassign: z.boolean().optional(),
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
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateStaffShare(token: string) {
  revalidatePath(`/staff-share/${token}`);
  revalidatePath("/staff-schedule");
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { token, taskId } = await params;
  const context = await findSharedStaffTask(token, taskId);
  if (!context) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  // `.parse()` throws, and so does `request.json()` on a body that

  // is not JSON. Uncaught, both leave the handler as a 500 -- which

  // is a crash report where a validation error belongs, and on the

  // staff routes it is reached from a phone on a bad connection.

  const parsedResult = taskPatchSchema.safeParse(await request.json().catch(() => null));

  if (!parsedResult.success) {

    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  }

  const parsed = parsedResult.data;
  if (context.task.status === StaffTaskStatus.cancelled) {
    return NextResponse.json({ error: "TASK_ALREADY_CANCELLED" }, { status: 400 });
  }

  if (parsed.unassign && context.task.status === StaffTaskStatus.done) {
    return NextResponse.json({ error: "TASK_ALREADY_CLOSED" }, { status: 400 });
  }

  const nextStatus = parsed.unassign
    ? StaffTaskStatus.todo
    : parsed.status
      ? (parsed.status as StaffTaskStatus)
      : context.task.status;
  const completedAt =
    nextStatus === StaffTaskStatus.done
      ? context.task.completedAt ?? new Date()
      : nextStatus === StaffTaskStatus.cancelled
        ? context.task.completedAt
        : null;

  const task = await prisma.staffTask.update({
    where: { id: context.task.id },
    data: {
      ...(parsed.unassign ? { staffId: null, staffLabel: null, parentTaskId: null, sortOrder: 0 } : {}),
      title: parsed.title ?? context.task.title,
      details: parsed.details === undefined ? context.task.details : nullable(parsed.details),
      dueDatetime:
        parsed.dueDatetime === undefined ? context.task.dueDatetime : parseDate(parsed.dueDatetime),
      timeWindow:
        parsed.timeWindow === undefined ? context.task.timeWindow : nullable(parsed.timeWindow),
      status: nextStatus,
      completedAt,
    },
    include: staffShareTaskInclude,
  });

  await logActivity({
    workspaceId: context.staff.workspaceId,
    actor: `${context.staff.name} (staff link)`,
    action: parsed.unassign ? "staff_task_unassigned_by_staff" : "staff_task_updated_by_staff",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, status: task.status, staffId: context.staff.id },
  });

  await notifyAdminsOfStaffTaskAction({
    workspaceId: context.staff.workspaceId,
    staffName: context.staff.name,
    staffEmail: context.staff.email,
    task,
    action: parsed.unassign
      ? "unassigned"
      : nextStatus === StaffTaskStatus.done && context.task.status !== StaffTaskStatus.done
        ? "completed"
        : "updated",
    origin: new URL(request.url).origin,
  });

  revalidateStaffShare(token);
  return NextResponse.json({
    task: parsed.unassign ? null : serializeStaffShareTask(token, task),
    unassigned: Boolean(parsed.unassign),
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { token, taskId } = await params;
  const context = await findSharedStaffTask(token, taskId);
  if (!context) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }

  const task = await prisma.staffTask.update({
    where: { id: context.task.id },
    data: {
      status: StaffTaskStatus.cancelled,
      completedAt: context.task.completedAt,
    },
    include: staffShareTaskInclude,
  });

  await logActivity({
    workspaceId: context.staff.workspaceId,
    actor: `${context.staff.name} (staff link)`,
    action: "staff_task_cancelled_by_staff",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, staffId: context.staff.id },
  });

  await notifyAdminsOfStaffTaskAction({
    workspaceId: context.staff.workspaceId,
    staffName: context.staff.name,
    staffEmail: context.staff.email,
    task,
    action: "cancelled",
    origin: new URL(_request.url).origin,
  });

  revalidateStaffShare(token);
  return NextResponse.json({ task: serializeStaffShareTask(token, task) });
}
