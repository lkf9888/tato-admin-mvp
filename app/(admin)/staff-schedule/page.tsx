import { StaffScheduleClient } from "@/components/staff-schedule-client";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { ensureStaffShareTokens } from "@/lib/staff-share";

export default async function StaffSchedulePage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, staff, tasks, vehicles, orders] = await Promise.all([
    getI18n(),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.staffTask.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ dueDatetime: "asc" }, { createdAt: "asc" }],
      include: {
        staff: true,
        vehicle: { select: { id: true, plateNumber: true, nickname: true } },
        order: { select: { id: true, renterName: true, pickupDatetime: true, returnDatetime: true } },
        attachments: {
          where: { isArchived: false },
          orderBy: { uploadedAt: "asc" },
        },
      },
    }),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
      select: { id: true, plateNumber: true, nickname: true, brand: true, model: true, year: true },
    }),
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
      },
      orderBy: { pickupDatetime: "desc" },
      take: 200,
      select: {
        id: true,
        renterName: true,
        pickupDatetime: true,
        returnDatetime: true,
        vehicle: { select: { plateNumber: true, nickname: true } },
      },
    }),
  ]);
  const staffWithShareTokens = await ensureStaffShareTokens(staff);

  return (
    <StaffScheduleClient
      locale={locale}
      initialStaff={staffWithShareTokens.map((member) => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        email: member.email,
        role: member.role,
        color: member.color,
        notes: member.notes,
        pinnedMessage: member.pinnedMessage,
        isActive: member.isActive,
        sortOrder: member.sortOrder,
        shareToken: member.shareToken,
      }))}
      initialTasks={tasks.map((task) => ({
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
        staff: task.staff
          ? {
              id: task.staff.id,
              name: task.staff.name,
              phone: task.staff.phone,
              email: task.staff.email,
              role: task.staff.role,
              color: task.staff.color,
              notes: task.staff.notes,
              pinnedMessage: task.staff.pinnedMessage,
              isActive: task.staff.isActive,
              sortOrder: task.staff.sortOrder,
              shareToken: task.staff.shareToken,
            }
          : null,
        vehicle: task.vehicle,
        attachments: task.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          uploadedAt: attachment.uploadedAt.toISOString(),
          url: `/api/staff-schedule/tasks/${task.id}/attachments/file?attachmentId=${attachment.id}`,
        })),
        order: task.order
          ? {
              ...task.order,
              pickupDatetime: task.order.pickupDatetime.toISOString(),
              returnDatetime: task.order.returnDatetime.toISOString(),
            }
          : null,
      }))}
      vehicles={vehicles}
      orders={orders.map((order) => ({
        id: order.id,
        renterName: order.renterName,
        pickupDatetime: order.pickupDatetime.toISOString(),
        returnDatetime: order.returnDatetime.toISOString(),
        vehicleLabel: `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`,
      }))}
    />
  );
}
