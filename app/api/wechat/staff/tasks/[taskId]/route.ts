import { NextRequest, NextResponse } from "next/server";
import { StaffTaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  ensureStaffShareToken,
  getBearerToken,
  getTaskStatusFromMiniProgram,
  serializeStaffMiniProgramTask,
  staffMiniProgramTaskInclude,
  verifyStaffMiniProgramSession,
} from "@/lib/staff-mini-program";
import { notifyAdminsOfStaffTaskAction } from "@/lib/staff-task-notifications";

type Params = Promise<{ taskId: string }>;

const taskPatchSchema = z.object({
  title: z.string().trim().min(2).optional(),
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

function getBaseUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffMiniProgramSession(token) : null;
  if (!staff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { taskId } = await params;
  const existing = await prisma.staffTask.findFirst({
    where: {
      id: taskId,
      workspaceId: staff.workspaceId,
      staffId: staff.id,
    },
    include: staffMiniProgramTaskInclude,
  });
  if (!existing) {
    return NextResponse.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
  }
  if (existing.status === StaffTaskStatus.cancelled) {
    return NextResponse.json({ error: "TASK_ALREADY_CANCELLED" }, { status: 400 });
  }

  const parsed = taskPatchSchema.parse(await request.json());
  if (parsed.unassign && existing.status === StaffTaskStatus.done) {
    return NextResponse.json({ error: "TASK_ALREADY_CLOSED" }, { status: 400 });
  }

  const parsedStatus = getTaskStatusFromMiniProgram(parsed.status);
  const nextStatus = parsed.unassign
    ? StaffTaskStatus.todo
    : parsedStatus
      ? parsedStatus
      : existing.status;
  const completedAt =
    nextStatus === StaffTaskStatus.done
      ? existing.completedAt ?? new Date()
      : nextStatus === StaffTaskStatus.cancelled
        ? existing.completedAt
        : null;

  const task = await prisma.staffTask.update({
    where: { id: existing.id },
    data: {
      ...(parsed.unassign ? { staffId: null, staffLabel: null, sortOrder: 0 } : {}),
      title: parsed.title ?? existing.title,
      details: parsed.details === undefined ? existing.details : nullable(parsed.details),
      dueDatetime:
        parsed.dueDatetime === undefined ? existing.dueDatetime : parseDate(parsed.dueDatetime),
      timeWindow:
        parsed.timeWindow === undefined ? existing.timeWindow : nullable(parsed.timeWindow),
      status: nextStatus,
      completedAt,
    },
    include: staffMiniProgramTaskInclude,
  });

  await logActivity({
    workspaceId: staff.workspaceId,
    actor: `${staff.name} (wechat mini program)`,
    action: parsed.unassign ? "staff_task_unassigned_by_staff_wechat" : "staff_task_updated_by_staff_wechat",
    entityType: "StaffTask",
    entityId: task.id,
    metadata: { title: task.title, status: task.status, staffId: staff.id },
  });

  await notifyAdminsOfStaffTaskAction({
    workspaceId: staff.workspaceId,
    staffName: staff.name,
    staffEmail: staff.email,
    task,
    action: parsed.unassign
      ? "unassigned"
      : nextStatus === StaffTaskStatus.done && existing.status !== StaffTaskStatus.done
        ? "completed"
        : "updated",
    origin: new URL(request.url).origin,
  });

  revalidatePath("/staff-schedule");
  if (staff.shareToken) revalidatePath(`/staff-share/${staff.shareToken}`);

  const shareToken = await ensureStaffShareToken(staff);
  if (!shareToken) {
    return NextResponse.json({ error: "STAFF_SHARE_TOKEN_NOT_AVAILABLE" }, { status: 500 });
  }
  return NextResponse.json({
    task: parsed.unassign
      ? null
      : serializeStaffMiniProgramTask({
          task,
          staffShareToken: shareToken,
          baseUrl: getBaseUrl(request),
        }),
    unassigned: Boolean(parsed.unassign),
  });
}
