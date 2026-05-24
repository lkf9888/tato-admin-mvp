import "server-only";

import { sendStaffTaskAssignmentEmail } from "@/lib/email";

type StaffTaskNotificationRecord = {
  title: string;
  details: string | null;
  dueDatetime: Date | null;
  timeWindow: string | null;
  staffLabel: string | null;
  vehicleLabel: string | null;
  orderLabel: string | null;
  staff: {
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
  if (!task.staff?.email) return;

  const taskUrl = task.staff.shareToken
    ? `${getBaseUrl(origin)}/staff-share/${task.staff.shareToken}`
    : null;

  await sendStaffTaskAssignmentEmail({
    to: task.staff.email,
    staffName: task.staff.name,
    taskTitle: task.title,
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
