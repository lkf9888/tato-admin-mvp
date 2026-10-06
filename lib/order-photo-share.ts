import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The trip behind a photo-share token, and its photos -- or null.
 *
 * Wrong, revoked and deleted all come back the same, so the page and the
 * file route cannot be used to tell a live token from a dead one. The
 * photos are read at request time, so a picture added after the link
 * went out is on it, and one deleted from the order is not.
 */
export async function findSharedTripPhotos(token: string) {
  if (!token || token.length < 20) return null;
  const share = await prisma.orderPhotoShare.findUnique({ where: { token } });
  if (!share) return null;
  const order = await prisma.order.findFirst({
    where: { id: share.orderId, workspaceId: share.workspaceId, isArchived: false },
    select: {
      id: true,
      pickupDatetime: true,
      returnDatetime: true,
      vehicle: { select: { plateNumber: true, brand: true, model: true, year: true } },
      workspace: { select: { name: true } },
      attachments: {
        where: { kind: "photo", isArchived: false },
        orderBy: { uploadedAt: "asc" },
        select: { id: true, filename: true, contentType: true, uploadedAt: true },
      },
    },
  });
  if (!order) return null;
  return { share, order };
}
