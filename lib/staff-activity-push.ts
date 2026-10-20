import "server-only";

import { notifyCategory } from "@/lib/web-push";

export type StaffActivity = "completed" | "updated" | "unassigned" | "cancelled" | "photos";

const VERBS: Record<Exclude<StaffActivity, "photos">, string> = {
  completed: "完成了",
  updated: "更新了",
  unassigned: "退回了",
  cancelled: "取消了",
};

/**
 * Tell the team's devices that a staff member did something to a task
 * from their side -- the staff link, the staff app or the mini program.
 * The "staff_tasks" notification category; what someone does in the
 * admin is not announced, since they did it themselves.
 *
 * One wording for every entry point: the task routes reach it through
 * notifyAdminsOfStaffTaskAction, the photo uploads call it directly.
 * Fire and forget -- a push never holds up or fails the staff request.
 */
export function pushStaffActivity(input: {
  workspaceId: string | null | undefined;
  staffName: string;
  task: {
    id?: string;
    title: string;
    details?: string | null;
    vehicleLabel?: string | null;
    vehicle?: { plateNumber: string } | null;
    orderLabel?: string | null;
    order?: { renterName: string } | null;
  };
  activity: StaffActivity;
  photoCount?: number;
}) {
  if (!input.workspaceId) return;
  const { task } = input;
  const title =
    input.activity === "photos"
      ? `${input.staffName} 上传了 ${input.photoCount ?? 1} 张照片 · ${task.title}`
      : `${input.staffName} ${VERBS[input.activity]}「${task.title}」`;
  const firstLine = task.details?.split("\n").find((line) => line.trim())?.trim() ?? null;
  const body = [
    task.vehicle?.plateNumber ?? task.vehicleLabel,
    task.order?.renterName ?? task.orderLabel,
    input.activity === "updated" ? firstLine : null,
  ]
    .filter(Boolean)
    .join(" · ");
  void notifyCategory(input.workspaceId, "staff_tasks", {
    title,
    body,
    url: "/staff-schedule",
    // Per task: a later change to the same task replaces the earlier
    // notification, while two tasks stay two.
    tag: task.id ? `staff-task:${task.id}` : "staff-tasks",
  }).catch(() => {});
}
