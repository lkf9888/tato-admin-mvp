import "server-only";

import { isAddOnUnit, type BookingAddOnOption } from "@/lib/booking-add-ons";
import { prisma } from "@/lib/prisma";

/** The extras a workspace currently offers, in the operator's order. */
export async function listBookingAddOns(workspaceId: string | null): Promise<BookingAddOnOption[]> {
  if (!workspaceId) return [];
  const rows = await prisma.bookingAddOn.findMany({
    where: { workspaceId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: Math.max(0, row.price),
    unit: isAddOnUnit(row.unit) ? row.unit : "booking",
    taxable: row.taxable,
  }));
}
