import { randomBytes } from "crypto";
import type { Prisma, StaffMember } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const staffShareTaskInclude = {
  vehicle: { select: { id: true, plateNumber: true, nickname: true } },
  order: { select: { id: true, renterName: true, pickupDatetime: true, returnDatetime: true } },
  attachments: {
    where: { isArchived: false },
    orderBy: { uploadedAt: "asc" as const },
  },
} satisfies Prisma.StaffTaskInclude;

export type StaffShareTaskRecord = Prisma.StaffTaskGetPayload<{
  include: typeof staffShareTaskInclude;
}>;

export function createStaffShareToken() {
  return randomBytes(24).toString("base64url");
}

export async function createAvailableStaffShareToken() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = createStaffShareToken();
    const existing = await prisma.staffMember.findFirst({
      where: { shareToken: token },
      select: { id: true },
    });
    if (!existing) return token;
  }

  throw new Error("Unable to allocate a unique staff share token.");
}

export async function assignStaffShareToken(staffId: string) {
  const shareToken = await createAvailableStaffShareToken();
  const staff = await prisma.staffMember.update({
    where: { id: staffId },
    data: { shareToken },
  });
  return staff.shareToken;
}

export async function ensureStaffShareTokens<T extends Pick<StaffMember, "id" | "shareToken">>(
  staff: T[],
) {
  const result = [...staff];

  for (let index = 0; index < result.length; index += 1) {
    const member = result[index];
    if (member.shareToken) continue;
    const shareToken = await assignStaffShareToken(member.id);
    result[index] = { ...member, shareToken };
  }

  return result;
}

export function staffShareTaskAttachmentUrl(token: string, taskId: string, attachmentId: string) {
  return `/api/staff-share/${token}/tasks/${taskId}/attachments/file?attachmentId=${attachmentId}`;
}

export function serializeStaffShareTask(token: string, task: StaffShareTaskRecord) {
  return {
    id: task.id,
    staffId: task.staffId,
    vehicleId: task.vehicleId,
    orderId: task.orderId,
    staffLabel: task.staffLabel,
    vehicleLabel: task.vehicleLabel,
    orderLabel: task.orderLabel,
    title: task.title,
    details: task.details,
    dueDatetime: task.dueDatetime ? task.dueDatetime.toISOString() : null,
    timeWindow: task.timeWindow,
    status: task.status,
    priority: task.priority,
    category: task.category,
    sortOrder: task.sortOrder,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    vehicle: task.vehicle,
    order: task.order
      ? {
          ...task.order,
          pickupDatetime: task.order.pickupDatetime.toISOString(),
          returnDatetime: task.order.returnDatetime.toISOString(),
        }
      : null,
    attachments: task.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      uploadedAt: attachment.uploadedAt.toISOString(),
      url: staffShareTaskAttachmentUrl(token, task.id, attachment.id),
    })),
  };
}

export async function findSharedStaff(token: string) {
  return prisma.staffMember.findFirst({
    where: {
      shareToken: token,
      isActive: true,
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      color: true,
      pinnedMessage: true,
      shareToken: true,
    },
  });
}

export async function findSharedStaffTask(token: string, taskId: string) {
  const staff = await findSharedStaff(token);
  if (!staff) return null;

  const task = await prisma.staffTask.findFirst({
    where: {
      id: taskId,
      workspaceId: staff.workspaceId,
      staffId: staff.id,
    },
    include: staffShareTaskInclude,
  });
  if (!task) return null;

  return { staff, task };
}
