import { NextRequest, NextResponse } from "next/server";
import { StaffTaskPriority, StaffTaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { findSharedStaff, serializeStaffShareTask, staffShareTaskInclude } from "@/lib/staff-share";
import { notifyAdminsOfStaffTaskAction } from "@/lib/staff-task-notifications";

type Params = Promise<{ token: string }>;

const taskSchema = z.object({
  parentTaskId: z.string().optional().nullable().or(z.literal("")),
  title: z.string().trim().min(1),
  details: z.string().trim().optional().nullable().or(z.literal("")),
  dueDatetime: z.string().optional().nullable().or(z.literal("")),
  timeWindow: z.string().trim().optional().nullable().or(z.literal("")),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
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
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateStaffShare(token: string) {
  revalidatePath(`/staff-share/${token}`);
  revalidatePath("/staff-schedule");
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { token } = await params;
  const staff = await findSharedStaff(token);
  if (!staff) {
    return NextResponse.json({ error: "STAFF_SHARE_NOT_FOUND" }, { status: 404 });
  }

  // `.parse()` throws, and so does `request.json()` on a body that

  // is not JSON. Uncaught, both leave the handler as a 500 -- which

  // is a crash report where a validation error belongs, and on the

  // staff routes it is reached from a phone on a bad connection.

  const parsedResult = taskSchema.safeParse(await request.json().catch(() => null));

  if (!parsedResult.success) {

    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  }

  const parsed = parsedResult.data;
  const parentTaskId = nullable(parsed.parentTaskId);
  if (parentTaskId) {
    const parentTask = await prisma.staffTask.findFirst({
      where: {
        id: parentTaskId,
        workspaceId: staff.workspaceId,
        staffId: staff.id,
      },
      select: { id: true },
    });
    if (!parentTask) {
      return NextResponse.json({ error: "PARENT_TASK_NOT_FOUND" }, { status: 400 });
    }
  }

  const task = await prisma.staffTask.create({
    data: {
      workspaceId: staff.workspaceId,
      staffId: staff.id,
      parentTaskId,
      title: parsed.title,
      details: parsed.details === undefined ? null : nullable(parsed.details),
      dueDatetime: parseDate(parsed.dueDatetime),
      timeWindow: nullable(parsed.timeWindow),
      status: parsed.status ? (parsed.status as StaffTaskStatus) : StaffTaskStatus.todo,
      priority: parsed.priority ? (parsed.priority as StaffTaskPriority) : StaffTaskPriority.normal,
      category: nullable(parsed.category),
      sortOrder: parsed.sortOrder ?? 0,
    },
    include: staffShareTaskInclude,
  });

  await logActivity({
    workspaceId: staff.workspaceId,
    actor: `${staff.name} (staff link)`,
    action: "staff_task_created_by_staff_link",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, staffId: staff.id },
  });

  await notifyAdminsOfStaffTaskAction({
    workspaceId: staff.workspaceId,
    staffName: staff.name,
    staffEmail: staff.email,
    task,
    action: "updated",
    origin: new URL(request.url).origin,
  });

  revalidateStaffShare(token);
  return NextResponse.json({ task: serializeStaffShareTask(token, task) });
}
