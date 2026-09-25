"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * Edits to a car's direct-booking terms from the fleet table.
 *
 * One patch shape for a single row and for a selection, so a bulk edit
 * cannot do anything a row edit could not. Every field is optional:
 * absent means "leave it", null means "follow the fleet" (or, for the
 * daily rate, "price it with the model"), and a number is the car's own
 * figure. The difference matters -- a bulk "set deposit to $500" must
 * not also wipe the insurance override somebody set by hand.
 */

const nullableMoney = z.number().finite().min(0).max(100000).nullable();

const patchSchema = z
  .object({
    directBookingEnabled: z.boolean(),
    bookingDailyRate: nullableMoney,
    bookingInsuranceFee: nullableMoney,
    bookingDepositAmount: nullableMoney,
    bookingTaxName: z.string().trim().max(40).nullable(),
    bookingTaxRate: z.number().finite().min(0).max(100).nullable(),
    bookingWeeklyDiscountPercent: z.number().finite().min(0).max(90).nullable(),
    bookingMinimumRentalDays: z.number().int().min(1).max(365).nullable(),
    bookingDailyKmAllowance: z.number().int().min(0).max(5000).nullable(),
    bookingExtraKmRate: z.number().finite().min(0).max(100).nullable(),
    bookingIntro: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict();

export type VehicleBookingPatch = z.infer<typeof patchSchema>;

const MAX_BULK = 500;

export type VehicleBookingUpdateResult =
  | { ok: true; updated: number }
  | { ok: false; error: "VALIDATION_ERROR" | "NOT_FOUND" | "EMPTY" };

export async function updateVehicleBookingAction(
  vehicleIds: string[],
  patch: VehicleBookingPatch,
): Promise<VehicleBookingUpdateResult> {
  const { workspace, user } = await requireCurrentAdminContext();

  const ids = Array.from(new Set((vehicleIds ?? []).filter((id) => typeof id === "string" && id)));
  const parsed = patchSchema.safeParse(patch);
  if (!parsed.success || ids.length > MAX_BULK) return { ok: false, error: "VALIDATION_ERROR" };
  if (ids.length === 0 || Object.keys(parsed.data).length === 0) return { ok: false, error: "EMPTY" };

  const data = { ...parsed.data };
  // An empty name is no name, which prints as the fleet's.
  if (data.bookingTaxName === "") data.bookingTaxName = null;
  if (data.bookingIntro === "") data.bookingIntro = null;
  if (data.bookingTaxRate != null) data.bookingTaxRate = +data.bookingTaxRate.toFixed(3);

  // Scoped in the write itself, not checked beforehand: an id from
  // another workspace simply matches nothing.
  const result = await prisma.vehicle.updateMany({
    where: { id: { in: ids }, workspaceId: workspace.id },
    data,
  });
  if (result.count === 0) return { ok: false, error: "NOT_FOUND" };

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "vehicle_direct_booking_updated",
    entityType: "Vehicle",
    entityId: ids.length === 1 ? ids[0] : `${result.count} vehicles`,
    metadata: { vehicleIds: ids, patch: data, updated: result.count },
  });

  // The public pages price from these, so they go stale with them.
  revalidatePath("/direct-booking");
  revalidatePath("/rental-site");
  revalidatePath("/reserve/[vehicleId]", "page");
  revalidatePath("/s/[slug]", "layout");
  return { ok: true, updated: result.count };
}
