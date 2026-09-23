import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Where a car may be collected and left.
 *
 * A fixed list, offered to renters as a choice. Nothing here accepts a
 * typed address: an operator cannot price a delivery to a street they
 * have never seen, and a renter who types one has been promised
 * something nobody agreed to.
 */

export type BookingLocationOption = {
  id: string;
  label: string;
  address: string | null;
  fee: number;
  isDefault: boolean;
};

export async function listBookingLocations(
  workspaceId: string | null,
): Promise<BookingLocationOption[]> {
  if (!workspaceId) return [];

  const rows = await prisma.bookingLocation.findMany({
    where: { workspaceId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  // Exactly one default is the intent; if the data disagrees, the
  // first one wins so the booking page cannot preselect two.
  let defaultSeen = false;
  return rows.map((row) => {
    const isDefault = row.isDefault && !defaultSeen;
    if (isDefault) defaultSeen = true;
    return {
      id: row.id,
      label: row.label,
      address: row.address,
      fee: Math.max(0, row.fee),
      isDefault,
    };
  });
}

/**
 * Resolve what the renter chose.
 *
 * An id that is not on the list resolves to null rather than to the
 * default: silently substituting a different place would hand somebody
 * a car at an address they did not pick.
 */
export function resolveBookingLocation(
  locations: BookingLocationOption[],
  id: string | null | undefined,
) {
  if (!id) return locations.find((location) => location.isDefault) ?? null;
  return locations.find((location) => location.id === id) ?? null;
}

/** What goes onto the order, so a handover has an address not a nickname. */
export function describeBookingLocation(location: BookingLocationOption | null) {
  if (!location) return null;
  return location.address?.trim()
    ? `${location.label} · ${location.address.trim()}`
    : location.label;
}
