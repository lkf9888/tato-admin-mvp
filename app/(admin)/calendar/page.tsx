import { CalendarView } from "@/components/calendar-view";
import { MobileScheduleList } from "@/components/mobile-schedule-list";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

export default async function CalendarPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, vehicles, owners, orders] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true },
      orderBy: { plateNumber: "asc" },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: {
          not: "cancelled",
        },
      },
      include: { vehicle: { include: { owner: true } } },
      orderBy: { pickupDatetime: "asc" },
    }),
  ]);

  // The 1400-line CalendarView is built around a horizontal-scroll
  // 2D timeline that requires both axes to be useful — perfect for a
  // 1280px laptop, hostile on a 375px phone. Mobile gets a vertical,
  // time-bucketed list instead (`MobileScheduleList`); desktop keeps
  // the timeline. Both render the same data, so a host who pulls up
  // the page on a phone sees the same source of truth as on the
  // browser, just laid out for their thumb.
  const scheduleOrders = orders.map((order) => ({
    id: order.id,
    vehicleName: order.vehicle.nickname,
    vehiclePlateNumber: order.vehicle.plateNumber,
    renterName: order.renterName,
    ownerName: order.vehicle.owner?.name ?? null,
    pickupDatetime: order.pickupDatetime,
    returnDatetime: order.returnDatetime,
    status: order.status,
    source: order.source,
    hasConflict: order.hasConflict,
  }));

  return (
    <>
      <MobileScheduleList
        orders={scheduleOrders}
        locale={locale}
        labels={messages.calendar.mobile}
        className="lg:hidden"
      />

      <div className="hidden lg:block">
        <CalendarView
          locale={locale}
          vehicleOptions={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.nickname,
            plateNumber: vehicle.plateNumber,
            secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
            ownerId: vehicle.ownerId,
            ownerName: vehicle.owner?.name,
          }))}
          ownerOptions={owners.map((owner) => ({
            id: owner.id,
            label: owner.name,
          }))}
          orders={orders.map((order) => ({
            id: order.id,
            source: order.source,
            status: order.status,
            hasConflict: order.hasConflict,
            vehicleId: order.vehicleId,
            vehicleName: order.vehicle.nickname,
            vehiclePlateNumber: order.vehicle.plateNumber,
            ownerId: order.vehicle.ownerId,
            ownerName: order.vehicle.owner?.name,
            renterName: order.renterName,
            renterPhone: order.renterPhone,
            pickupDatetime: order.pickupDatetime.toISOString(),
            returnDatetime: order.returnDatetime.toISOString(),
            totalPrice: getOrderNetEarning(order.sourceMetadata, order.totalPrice),
            notes: getDisplayOrderNote(order.notes, order.source),
          }))}
        />
      </div>
    </>
  );
}
