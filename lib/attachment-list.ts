import "server-only";

import type { OrderAttachmentKind, Prisma } from "@prisma/client";

import { utcToZonedDate } from "@/lib/booking-time";
import { prisma } from "@/lib/prisma";

/**
 * The photos and documents pages' filter, and the ZIP export's: one
 * definition, so the archive holds exactly what the page lists.
 *
 * Attached to a trip or a car (anything else is a stray upload), of one
 * kind, optionally on some cars, optionally matching a search. Combined
 * with AND -- writing the car filter as a second `OR` key, as the pages
 * once did, silently replaced the "attached to something" condition.
 */
export function attachmentListWhere(
  workspaceId: string,
  filters: { kind: OrderAttachmentKind; vehicleIds: string[]; q: string },
): Prisma.OrderAttachmentWhereInput {
  const and: Prisma.OrderAttachmentWhereInput[] = [
    { OR: [{ orderId: { not: null } }, { vehicleId: { not: null } }] },
  ];
  if (filters.vehicleIds.length) {
    and.push({
      OR: [{ vehicleId: { in: filters.vehicleIds } }, { order: { vehicleId: { in: filters.vehicleIds } } }],
    });
  }
  if (filters.q) {
    and.push({
      OR: [
        { filename: { contains: filters.q } },
        { order: { renterName: { contains: filters.q } } },
        { order: { renterPhone: { contains: filters.q } } },
        { order: { notes: { contains: filters.q } } },
        ...(filters.kind === "document" ? [{ order: { contractNumber: { contains: filters.q } } }] : []),
        { order: { vehicle: { plateNumber: { contains: filters.q } } } },
        { order: { vehicle: { nickname: { contains: filters.q } } } },
        { vehicle: { plateNumber: { contains: filters.q } } },
        { vehicle: { nickname: { contains: filters.q } } },
      ],
    });
  }
  return { workspaceId, isArchived: false, kind: filters.kind, AND: and };
}

export function parseAttachmentFilters(params: { vehicle?: string | null; q?: string | null }) {
  return {
    vehicleIds: params.vehicle ? params.vehicle.split(",").filter(Boolean) : [],
    q: params.q?.trim() ?? "",
  };
}

/** A path segment safe in a ZIP on every OS. */
function safeSegment(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "_";
}

/**
 * Every matching file, with the folder it goes in: the car, then the trip
 * (pick-up day and guest), or the car's own files. Names are made unique
 * inside a folder, since two phones both call their photo IMG_0001.
 */
export async function buildAttachmentManifest(
  workspaceId: string,
  filters: { kind: OrderAttachmentKind; vehicleIds: string[]; q: string },
  labels: { vehicleFiles: string },
) {
  const rows = await prisma.orderAttachment.findMany({
    where: attachmentListWhere(workspaceId, filters),
    orderBy: { uploadedAt: "asc" },
    select: {
      id: true,
      orderId: true,
      vehicleId: true,
      filename: true,
      size: true,
      uploadedAt: true,
      vehicle: { select: { plateNumber: true } },
      order: {
        select: { renterName: true, pickupDatetime: true, vehicle: { select: { plateNumber: true } } },
      },
    },
  });

  const used = new Map<string, Set<string>>();
  return rows.map((row) => {
    const plate = row.order?.vehicle.plateNumber ?? row.vehicle?.plateNumber ?? "_";
    const folder = row.order
      ? `${safeSegment(plate)}/${safeSegment(`${utcToZonedDate(row.order.pickupDatetime)} ${row.order.renterName}`)}`
      : `${safeSegment(plate)}/${safeSegment(labels.vehicleFiles)}`;
    const original = safeSegment(row.filename || `${row.id}`);
    const names = used.get(folder) ?? new Set<string>();
    let name = original;
    for (let n = 2; names.has(name.toLowerCase()); n += 1) {
      const dot = original.lastIndexOf(".");
      name = dot > 0 ? `${original.slice(0, dot)} (${n})${original.slice(dot)}` : `${original} (${n})`;
    }
    names.add(name.toLowerCase());
    used.set(folder, names);
    return {
      path: `${folder}/${name}`,
      size: row.size ?? 0,
      // The same route the pages link to, so the files come down with the
      // same access check.
      url: row.vehicleId
        ? `/api/vehicles/${row.vehicleId}/attachments/file?attachmentId=${row.id}`
        : `/api/orders/${row.orderId}/attachments/file?attachmentId=${row.id}`,
    };
  });
}
