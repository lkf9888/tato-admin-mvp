"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { normalizeAgreementClauses } from "@/lib/rental-agreement-clauses";
import { createCoupon } from "@/lib/booking-coupons-server";
import { zonedDateTimeToUtc } from "@/lib/booking-time";
import { VEHICLE_FEATURES } from "@/lib/vehicle-features";
import { ADD_ON_NAME_MAX, isAddOnUnit } from "@/lib/booking-add-ons";

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
    bookingFeatures: z.array(z.enum(VEHICLE_FEATURES)).max(VEHICLE_FEATURES.length).nullable(),
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
  // Stored as JSON in list order; none selected is null.
  if (data.bookingTaxRate != null) data.bookingTaxRate = +data.bookingTaxRate.toFixed(3);

  // Scoped in the write itself, not checked beforehand: an id from
  // another workspace simply matches nothing.
  const { bookingFeatures, ...columns } = data;
  const result = await prisma.vehicle.updateMany({
    where: { id: { in: ids }, workspaceId: workspace.id },
    data: {
      ...columns,
      ...(bookingFeatures !== undefined
        ? {
            bookingFeatures:
              bookingFeatures && bookingFeatures.length > 0
                ? JSON.stringify(VEHICLE_FEATURES.filter((item) => bookingFeatures.includes(item)))
                : null,
          }
        : {}),
    },
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
  revalidatePath("/direct-booking/site");
  revalidatePath("/reserve/[vehicleId]", "page");
  revalidatePath("/s/[slug]", "layout");
  return { ok: true, updated: result.count };
}

/**
 * Save the rental agreement's clauses for every car in the workspace.
 *
 * The form posts headings and bodies as parallel lists in display
 * order. Nothing is regenerated here: the next booking's agreement
 * notices the text changed (its fingerprint) and is built from it, and
 * agreements already sent keep the wording their renter saw.
 */
export async function saveAgreementClausesAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const headings = formData.getAll("clauseHeading").map(String);
  const bodies = formData.getAll("clauseBody").map(String);
  const clauses = normalizeAgreementClauses(
    bodies.map((body, index) => ({ heading: headings[index] ?? "", body })),
  );
  if (clauses.length === 0) {
    redirect("/direct-booking?tab=agreement&agreementError=empty");
  }

  await prisma.rentalAgreementClauseSet.upsert({
    where: { workspaceId: workspace.id },
    update: { clauses: JSON.stringify(clauses), updatedBy: user.name },
    create: { workspaceId: workspace.id, clauses: JSON.stringify(clauses), updatedBy: user.name },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "rental_agreement_clauses_updated",
    entityType: "RentalAgreementClauseSet",
    entityId: workspace.id,
    metadata: { count: clauses.length, headings: clauses.map((clause) => clause.heading) },
  });

  revalidatePath("/direct-booking");
  revalidatePath("/reserve/[vehicleId]", "page");
  revalidatePath("/s/[slug]", "layout");
  redirect("/direct-booking?tab=agreement&agreementSaved=1");
}

/** Back to the built-in wording: the workspace's own set is removed. */
export async function resetAgreementClausesAction() {
  const { workspace, user } = await requireCurrentAdminContext();
  await prisma.rentalAgreementClauseSet.deleteMany({ where: { workspaceId: workspace.id } });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "rental_agreement_clauses_reset",
    entityType: "RentalAgreementClauseSet",
    entityId: workspace.id,
    metadata: {},
  });
  revalidatePath("/direct-booking");
  revalidatePath("/reserve/[vehicleId]", "page");
  revalidatePath("/s/[slug]", "layout");
  redirect("/direct-booking?tab=agreement&agreementSaved=1");
}

const couponFormSchema = z.object({
  kind: z.enum(["percent", "amount"]),
  value: z.coerce.number().finite().positive(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  note: z.string().trim().max(120).optional(),
});

/**
 * Generate a single-use coupon. The code is random, so an operator
 * never has to invent one, and prefixed with the workspace's first
 * letters so a renter can tell whose it is.
 */
export async function createCouponAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = couponFormSchema.safeParse({
    kind: formData.get("kind"),
    value: formData.get("value"),
    expiresOn: formData.get("expiresOn")?.toString() ?? "",
    note: formData.get("note")?.toString() ?? "",
  });
  if (!parsed.success || (parsed.data.kind === "percent" && parsed.data.value > 100)) {
    redirect("/direct-booking?tab=rules&couponError=invalid#coupons");
  }
  const { kind, value, expiresOn, note } = parsed.data;
  // The end of the chosen day in Vancouver, so "expires on the 31st"
  // still works on the 31st.
  const expiresAt = expiresOn ? zonedDateTimeToUtc(expiresOn, "23:59") : null;
  const prefix =
    (workspace.name ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "TATO";

  const coupon = await createCoupon({
    workspaceId: workspace.id,
    kind,
    value: Math.round(value * 100) / 100,
    expiresAt,
    note: note || null,
    createdBy: user.name,
    prefix,
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "booking_coupon_created",
    entityType: "BookingCoupon",
    entityId: coupon.id,
    metadata: { code: coupon.code, kind, value: coupon.value, expiresAt },
  });
  revalidatePath("/direct-booking");
  redirect(`/direct-booking?tab=rules&couponCreated=${encodeURIComponent(coupon.code)}#coupons`);
}

/** Withdraw an unused code; a used one is history and stays as it is. */
export async function voidCouponAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const id = formData.get("id")?.toString() ?? "";
  const result = await prisma.bookingCoupon.updateMany({
    where: { id, workspaceId: workspace.id, redeemedAt: null, voidedAt: null },
    data: { voidedAt: new Date(), reservedSessionId: null, reservedUntil: null },
  });
  if (result.count > 0) {
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "booking_coupon_voided",
      entityType: "BookingCoupon",
      entityId: id,
      metadata: {},
    });
  }
  revalidatePath("/direct-booking");
  redirect("/direct-booking?tab=rules#coupons");
}

/**
 * Save the extras renters can add. The form posts parallel lists in
 * display order, like the locations editor; a row with no name is an
 * empty line. Rows that disappeared are hidden, not deleted, so a
 * booking that bought one still reads sensibly.
 */
export async function saveBookingAddOnsAction(formData: FormData) {
  const { workspace, user } = await requireCurrentAdminContext();
  const list = (key: string) => formData.getAll(key).map((value) => value.toString().trim());
  const ids = list("addOnId");
  const names = list("addOnName");
  const descriptions = list("addOnDescription");
  const prices = list("addOnPrice");
  const units = list("addOnUnit");
  const taxables = list("addOnTaxable");

  const rows = names
    .map((name, index) => ({
      id: ids[index] || null,
      name: name.slice(0, ADD_ON_NAME_MAX),
      description: descriptions[index]?.slice(0, 160) || null,
      price: Math.min(100000, Math.max(0, Math.round(Number(prices[index] || 0) * 100) / 100)) || 0,
      unit: isAddOnUnit(units[index]) ? units[index] : "booking",
      taxable: taxables[index] === "1",
      sortOrder: index,
    }))
    .filter((row) => row.name.length > 0);

  const existing = await prisma.bookingAddOn.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const keptIds = new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)));

  await prisma.$transaction([
    prisma.bookingAddOn.updateMany({
      where: { workspaceId: workspace.id, id: { notIn: [...keptIds] } },
      data: { isActive: false },
    }),
    ...rows.map(({ id, ...data }) =>
      // An id from elsewhere is treated as new rather than trusted.
      id && existingIds.has(id)
        ? prisma.bookingAddOn.update({ where: { id }, data: { ...data, isActive: true } })
        : prisma.bookingAddOn.create({ data: { ...data, workspaceId: workspace.id } }),
    ),
  ]);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "booking_add_ons_updated",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: { count: rows.length, names: rows.map((row) => row.name) },
  });

  revalidatePath("/direct-booking");
  revalidatePath("/reserve/[vehicleId]", "page");
  revalidatePath("/s/[slug]", "layout");
  redirect("/direct-booking?tab=rules&addOnsSaved=1#add-ons");
}
