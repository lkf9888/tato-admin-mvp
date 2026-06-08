import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ContractsClient from "./ContractsClient";

export default async function ContractsPage() {
  const { workspace } = await requireCurrentAdminContext();

  const [templates, envelopes, bookings, textPresets] = await Promise.all([
    prisma.contractTemplate.findMany({
      where: { workspaceId: workspace.id, active: true },
      orderBy: { createdAt: "desc" },
      include: {
        fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
        recipients: { orderBy: { signingOrder: "asc" } },
      },
    }),
    prisma.contractEnvelope.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        template: { select: { id: true, name: true } },
        recipients: { orderBy: { signingOrder: "asc" } },
        order: {
          select: {
            id: true,
            renterName: true,
            pickupDatetime: true,
            returnDatetime: true,
            vehicle: { select: { plateNumber: true, nickname: true } },
          },
        },
      },
    }),
    prisma.order.findMany({
      where: { workspaceId: workspace.id, isArchived: false },
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
    prisma.contractTextPreset.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <ContractsClient
      userId={workspace.id}
      templates={JSON.parse(JSON.stringify(templates))}
      envelopes={JSON.parse(JSON.stringify(envelopes.map(({ order, ...envelope }) => ({
        ...envelope,
        booking: order
          ? {
              id: order.id,
              guestName: order.renterName,
              checkIn: order.pickupDatetime,
              checkOut: order.returnDatetime,
              property: {
                name: order.vehicle.plateNumber,
                nickname: order.vehicle.nickname,
              },
            }
          : null,
      }))))}
      textPresets={JSON.parse(JSON.stringify(textPresets))}
      bookings={bookings.map((booking) => ({
        id: booking.id,
        guestName: booking.renterName,
        guestEmail: null,
        checkIn: booking.pickupDatetime.toISOString(),
        checkOut: booking.returnDatetime.toISOString(),
        property: {
          name: booking.vehicle.plateNumber,
          nickname: booking.vehicle.nickname,
        },
      }))}
    />
  );
}
