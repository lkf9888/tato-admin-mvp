import { TrashList } from "@/components/trash-list";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

/**
 * Deleted orders, and the way back.
 *
 * Deleting an order has always been a soft delete: it sets
 * `isArchived` and the row stays with everything on it, photos and
 * files included. Nothing in the app ever showed that, so from the
 * outside a mis-click was indistinguishable from a permanent loss --
 * which is the worst of both, since the data was still there taking
 * up space and answering nobody.
 */

/** Recent deletions are the ones anybody wants back. Older than this
 *  and the question is an audit, which /activity answers. */
const PAGE_SIZE = 100;

export default async function TrashPage() {
  const workspace = await requireCurrentWorkspace();
  const { locale, messages } = await getI18n();

  const orders = await prisma.order.findMany({
    where: { workspaceId: workspace.id, isArchived: true },
    include: { vehicle: { select: { plateNumber: true, nickname: true } } },
    orderBy: { updatedAt: "desc" },
    take: PAGE_SIZE,
  });

  return (
    <TrashList
      locale={locale}
      labels={messages.calendar.trashPage}
      orders={orders.map((order) => ({
        id: order.id,
        renterName: order.renterName,
        vehiclePlateNumber: order.vehicle.plateNumber,
        vehicleName: order.vehicle.nickname,
        pickupDatetime: order.pickupDatetime.toISOString(),
        returnDatetime: order.returnDatetime.toISOString(),
        deletedAt: order.updatedAt.toISOString(),
        source: order.source,
        totalPrice: getOrderNetEarning(order.sourceMetadata, order.totalPrice),
      }))}
    />
  );
}
