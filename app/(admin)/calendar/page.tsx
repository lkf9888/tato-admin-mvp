import { CalendarView } from "@/components/calendar-view";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

export default async function CalendarPage() {
  const [{ locale }, vehicles, owners, orders] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      include: { owner: true },
      orderBy: { plateNumber: "asc" },
    }),
    prisma.owner.findMany({
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      include: { vehicle: { include: { owner: true } } },
      orderBy: { pickupDatetime: "asc" },
    }),
  ]);

  return (
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
  );
}
