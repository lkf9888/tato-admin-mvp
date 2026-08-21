import "server-only";

import { OrderSource } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Which car a Turo trip is actually on, and how much we know it.
 *
 * There are two ways a Turo order learns its vehicle, and they are not
 * equally trustworthy.
 *
 * The CSV export names the plate. That is the car, stated by Turo,
 * and there is nothing to infer.
 *
 * Booking mail names a model: "your Mitsubishi RVR", "your Volvo
 * XC40". It never names a plate. So the vehicle is worked out by
 * matching that text against the fleet, and the match refuses when
 * more than one car answers to it -- which reads as a safe rule and is
 * not one, because it is only as good as the fleet being complete.
 *
 * That is how reservation 60562604 went wrong. The trip was on
 * A661GL, a Mitsubishi RVR 2026 that exists in the CSV and had never
 * been imported into the fleet. To the matcher the fleet held exactly
 * one RVR 2026, so the text resolved uniquely, and a booking was
 * filed with confidence against a car it was never on.
 *
 * Uniqueness in a partial fleet is not evidence. Nothing in the data
 * distinguishes "the only car of this model" from "the only one we
 * happen to know about", so the assignment has to be treated as
 * provisional until a plate confirms it -- which is what this module
 * is for.
 *
 * The test needs no new column. A CSV import stamps `importBatchId` on
 * every row it writes, including rows it is correcting, so a Turo
 * order with no batch is one no plate has ever confirmed. Offline
 * orders are excluded: a person picked the car from a list, which is
 * a confirmation of a different kind but still a person looking at it.
 */
export function isPlateUnconfirmed(order: {
  source: OrderSource;
  importBatchId: string | null;
}): boolean {
  return order.source === OrderSource.turo && order.importBatchId === null;
}

export type UnconfirmedAssignment = {
  orderId: string;
  externalOrderId: string | null;
  renterName: string;
  pickupDatetime: Date;
  returnDatetime: Date;
  vehicleId: string;
  vehicleLabel: string;
  plateNumber: string | null;
  /**
   * How many cars in the fleet are the same model and year. One means
   * the match was unique *given what the fleet holds* -- which is the
   * case that looks safe and is the one that produced the wrong
   * assignment, so it is reported rather than filtered out.
   */
  sameModelYearCount: number;
};

/**
 * Every Turo trip whose car no plate has confirmed.
 *
 * Ordered by pickup, soonest first: a wrong car matters most on the
 * trip that is about to hand over.
 */
export async function findUnconfirmedAssignments(
  workspaceId: string,
  options: { limit?: number; from?: Date } = {},
): Promise<UnconfirmedAssignment[]> {
  const orders = await prisma.order.findMany({
    where: {
      workspaceId,
      source: OrderSource.turo,
      importBatchId: null,
      isArchived: false,
      // Trips already over are the CSV's business and will be
      // corrected by the next export. What needs eyes is what has not
      // happened yet.
      returnDatetime: { gte: options.from ?? new Date() },
    },
    orderBy: { pickupDatetime: "asc" },
    take: options.limit ?? 50,
    select: {
      id: true,
      externalOrderId: true,
      renterName: true,
      pickupDatetime: true,
      returnDatetime: true,
      vehicleId: true,
      vehicle: {
        select: { brand: true, model: true, year: true, plateNumber: true },
      },
    },
  });

  if (orders.length === 0) return [];

  // One query for the sibling counts rather than one per order.
  const fleet = await prisma.vehicle.findMany({
    where: { workspaceId },
    select: { brand: true, model: true, year: true },
  });

  const key = (brand: string, model: string, year: number) =>
    `${brand}|${model}|${year}`.toLowerCase();

  const counts = new Map<string, number>();
  for (const vehicle of fleet) {
    const k = key(vehicle.brand, vehicle.model, vehicle.year);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return orders.map((order) => ({
    orderId: order.id,
    externalOrderId: order.externalOrderId,
    renterName: order.renterName,
    pickupDatetime: order.pickupDatetime,
    returnDatetime: order.returnDatetime,
    vehicleId: order.vehicleId,
    vehicleLabel: `${order.vehicle.year} ${order.vehicle.brand} ${order.vehicle.model}`,
    plateNumber: order.vehicle.plateNumber,
    sameModelYearCount:
      counts.get(key(order.vehicle.brand, order.vehicle.model, order.vehicle.year)) ?? 1,
  }));
}

/**
 * Cars the CSV named that the fleet does not have.
 *
 * The reason the check above matters at all. An import row whose plate
 * matches no vehicle is recorded as a failure and the row is dropped --
 * correctly, since there is nowhere to put it -- but the consequence
 * outlives the import: the fleet is now missing a car that Turo is
 * renting out, and every later booking email for that model matches
 * one car fewer than really exists. A661GL was in the CSV and not in
 * the fleet, which is precisely why "Mitsubishi RVR 2026" looked
 * unique.
 *
 * Read back out of the stored failures rather than tracked separately,
 * so it covers imports that already happened.
 */
export async function findUnknownVehiclesFromImports(
  workspaceId: string,
  limit = 12,
): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({
    where: { workspaceId, failedRows: { gt: 0 } },
    orderBy: { importedAt: "desc" },
    take: 10,
    select: { failures: true },
  });

  const labels = new Set<string>();

  for (const batch of batches) {
    if (!batch.failures) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(batch.failures);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const reason = (row as { reason?: unknown })?.reason;
      if (typeof reason !== "string") continue;
      // The importer writes: Vehicle not found for "A661GL"
      const named = reason.match(/^Vehicle not found for "(.+)"$/)?.[1]?.trim();
      if (named) labels.add(named);
      if (labels.size >= limit) return [...labels];
    }
  }

  return [...labels];
}
