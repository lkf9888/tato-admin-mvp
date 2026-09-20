import "server-only";

import {
  sendStaffTaskAdminNotificationEmail,
  sendStaffTaskAssignmentEmail,
} from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { sendStaffTaskSms } from "@/lib/sms";
import { sendNotification, staffChannelKey } from "@/lib/notify-client";
import {
  buildStaffTaskTemplateValues,
  normalizeStaffTaskNotificationTemplate,
  renderStaffTaskTemplate,
} from "@/lib/staff-task-notification-template";

type StaffTaskNotificationRecord = {
  workspaceId?: string | null;
  id?: string;
  title: string;
  details: string | null;
  dueDatetime: Date | null;
  /** Discriminates one save from the next in the hub's dedupe key: a
   *  retry of the same save is a duplicate, a genuine second edit is
   *  not. */
  updatedAt?: Date;
  timeWindow: string | null;
  staffLabel: string | null;
  vehicleLabel: string | null;
  orderLabel: string | null;
  staff?: {
    /** Needed for the notification hub: the channel key is derived
     *  from it, so a renamed staff member keeps their subscribers. */
    id?: string;
    name: string;
    email: string | null;
    phone?: string | null;
    shareToken: string | null;
    wechatOpenId?: string | null;
    wechatNotificationEnabled?: boolean | null;
  } | null;
  vehicle: {
    plateNumber: string;
    nickname: string;
  } | null;
  order: {
    renterName: string;
  } | null;
};

/** What the notification calls each kind of change. Five characters or
 *  fewer: the template's `phrase` field will not take more. */
const ACTION_LABELS: Record<"created" | "updated" | "deleted" | "removed", string> = {
  created: "新任务",
  updated: "任务更新",
  deleted: "任务删除",
  removed: "任务移除",
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
  if (!task.staff) return;

  const taskUrl =
    action === "deleted" || action === "removed"
      ? null
      : task.staff.shareToken
        ? `${getBaseUrl(origin)}/staff-share/${task.staff.shareToken}`
        : null;

  const vehicleLabel = task.vehicle
    ? `${task.vehicle.plateNumber} · ${task.vehicle.nickname}`
    : task.vehicleLabel;
  const orderLabel = task.order ? task.order.renterName : task.orderLabel;
  const savedTemplate = task.workspaceId
    ? await prisma.staffTaskNotificationTemplate.findUnique({
        where: { workspaceId: task.workspaceId },
      })
    : null;
  const template = savedTemplate ? normalizeStaffTaskNotificationTemplate(savedTemplate) : null;
  const templateValues = template
    ? buildStaffTaskTemplateValues({
        staffName: task.staff.name,
        taskTitle: task.title,
        action,
        dueLabel: formatDueDate(task.dueDatetime),
        timeWindow: task.timeWindow,
        vehicleLabel,
        orderLabel,
        details: task.details,
        taskUrl,
      })
    : null;

  if (task.staff.email) {
    await sendStaffTaskAssignmentEmail({
      to: task.staff.email,
      staffName: task.staff.name,
      taskTitle: task.title,
      action,
      dueLabel: formatDueDate(task.dueDatetime),
      timeWindow: task.timeWindow,
      vehicleLabel,
      orderLabel,
      details: task.details,
      taskUrl,
      renderedSubject:
        template && templateValues
          ? renderStaffTaskTemplate(template.emailSubjectTemplate, templateValues)
          : null,
      renderedBody:
        template && templateValues
          ? renderStaffTaskTemplate(template.emailBodyTemplate, templateValues)
          : null,
    });
  }

  if (task.staff.phone) {
    await sendStaffTaskSms({
      to: task.staff.phone,
      staffName: task.staff.name,
      taskTitle: task.title,
      action,
      dueLabel: formatDueDate(task.dueDatetime),
      timeWindow: task.timeWindow,
      vehicleLabel,
      orderLabel,
      details: task.details,
      taskUrl,
      renderedBody:
        template && templateValues
          ? renderStaffTaskTemplate(template.smsBodyTemplate, templateValues)
          : null,
    });
  }

  // WeChat goes through the notification hub. TATO no longer knows a
  // template id or an appid -- it names a channel and a logical
  // template, and the hub works out the rest. `channelName` creates the
  // channel on first use, so a staff member who has never been
  // assigned anything does not need provisioning first.
  //
  // Deliberately last and deliberately not awaited for its result
  // beyond this: email and SMS have already gone out, and a hub that
  // is down must not fail the assignment that triggered it.
  if (task.staff.id) {
    await sendNotification({
      channel: staffChannelKey(task.staff.id),
      channelName: task.staff.name,
      template: "task",
      // Assignments and removals are what a person needs to see now; an
      // edit to a task they already know about can wait for the next
      // top-up if quota is short.
      priority: action === "created" || action === "removed" ? "high" : "normal",
      dedupeKey: task.id ? `task:${task.id}:${action}:${task.updatedAt?.getTime() ?? ""}` : undefined,
      data: {
        title: task.title,
        due: task.dueDatetime ? task.dueDatetime.toISOString() : new Date().toISOString(),
        vehicle: vehicleLabel,
        action: ACTION_LABELS[action],
        details: task.details || task.timeWindow || orderLabel || "请查看任务详情",
      },
      link: taskUrl ? { url: taskUrl } : null,
    });
  }
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
