import { StaffScheduleClient } from "@/components/staff-schedule-client";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";

export default async function StaffSchedulePage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, staff, tasks, vehicles, orders] = await Promise.all([
    getI18n(),
    prisma.staffMember.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
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

  return (
    <StaffScheduleClient
      locale={locale}
      initialStaff={staff.map((member) => ({
        id: member.id,
        name: member.name,
        phone: member.phone,
        email: member.email,
        role: member.role,
        color: member.color,
        notes: member.notes,
        pinnedMessage: member.pinnedMessage,
        isActive: member.isActive,
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
