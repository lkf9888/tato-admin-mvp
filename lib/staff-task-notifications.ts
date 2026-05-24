import "server-only";

import {
  sendStaffTaskAdminNotificationEmail,
  sendStaffTaskAssignmentEmail,
} from "@/lib/email";
import { prisma } from "@/lib/prisma";

type StaffTaskNotificationRecord = {
  title: string;
  details: string | null;
  dueDatetime: Date | null;
  timeWindow: string | null;
  staffLabel: string | null;
  vehicleLabel: string | null;
  orderLabel: string | null;
  staff?: {
    name: string;
    email: string | null;
    shareToken: string | null;
  } | null;
  vehicle: {
    plateNumber: string;
    nickname: string;
  } | null;
  order: {
    renterName: string;
  } | null;
};

function getBaseUrl(origin?: string) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (envUrl || origin || "http://localhost:3000").replace(/\/$/, "");
}

function formatDueDate(value: Date | null) {
  if (!value) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())}`;
}

export async function notifyStaffTaskAssignment(
  task: StaffTaskNotificationRecord,
  origin?: string,
) {
  await notifyStaffTaskChange(task, "created", origin);
}

export async function notifyStaffTaskChange(
  task: StaffTaskNotificationRecord,
  action: "created" | "updated" | "deleted" | "removed",
  origin?: string,
) {
  if (!task.staff?.email) return;

  const taskUrl =
    action === "deleted" || action === "removed"
      ? null
      : task.staff.shareToken
        ? `${getBaseUrl(origin)}/staff-share/${task.staff.shareToken}`
        : null;

  await sendStaffTaskAssignmentEmail({
    to: task.staff.email,
    staffName: task.staff.name,
    taskTitle: task.title,
    action,
    dueLabel: formatDueDate(task.dueDatetime),
    timeWindow: task.timeWindow,
    vehicleLabel: task.vehicle
      ? `${task.vehicle.plateNumber} · ${task.vehicle.nickname}`
      : task.vehicleLabel,
    orderLabel: task.order ? task.order.renterName : task.orderLabel,
    details: task.details,
    taskUrl,
  });
}

export async function notifyAdminsOfStaffTaskAction(input: {
  workspaceId: string | null;
  staffName: string;
  staffEmail?: string | null;
  task: StaffTaskNotificationRecord;
  action: "completed" | "updated" | "unassigned" | "cancelled";
  origin?: string;
}) {
  if (!input.workspaceId) return;

  const users = await prisma.user.findMany({
    where: { workspaceId: input.workspaceId },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  const recipients = Array.from(
    new Set(users.map((user) => user.email.trim().toLowerCase()).filter(Boolean)),
  );
  if (recipients.length === 0) return;

  const adminUrl = `${getBaseUrl(input.origin)}/staff-schedule`;
  await Promise.allSettled(
    recipients.map((to) =>
      sendStaffTaskAdminNotificationEmail({
        to,
        staffName: input.staffName,
        staffEmail: input.staffEmail,
        taskTitle: input.task.title,
        action: input.action,
        dueLabel: formatDueDate(input.task.dueDatetime),
        timeWindow: input.task.timeWindow,
        vehicleLabel: input.task.vehicle
          ? `${input.task.vehicle.plateNumber} · ${input.task.vehicle.nickname}`
          : input.task.vehicleLabel,
        orderLabel: input.task.order ? input.task.order.renterName : input.task.orderLabel,
        details: input.task.details,
        adminUrl,
      }),
    ),
  );
}
