import { OrderStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { resolveCleaningFee } from "@/lib/owner-commission";
import { getOrderFeeLines } from "@/lib/ledger-policy";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { roundCurrencyAmount } from "@/lib/utils";

type Params = Promise<{ orderId: string }>;

const nullableString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized ? normalized : null;
}, z.string().nullable().optional());

const nullableNumber = z.preprocess((value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return value;
}, z.number().nonnegative().nullable().optional());

const orderUpdateSchema = z.object({
  vehicleId: z.string().min(1),
  renterName: z.string().trim().min(2),
  renterPhone: nullableString,
  pickupDatetime: z.string().min(1),
  returnDatetime: z.string().min(1),
  totalPrice: nullableNumber,
  depositAmount: nullableNumber,
  status: z.nativeEnum(OrderStatus),
  pickupLocation: nullableString,
  returnLocation: nullableString,
  paymentMethod: nullableString,
  contractNumber: nullableString,
  notes: nullableString,
  // Not a property of this order. Saving it writes a dated rule on the
  // vehicle that prices every trip of that car starting on or after
  // the given day -- including this one, which is why it is edited
  // from here rather than buried in the vehicle form.
  cleaningFee: nullableNumber.optional(),
  cleaningFeeFrom: z.string().optional(),
});

function revalidateOrderSurfaces() {
  [
    "/dashboard",
    "/orders",
    "/calendar",
    "/owners",
    "/owner-statements",
    "/vehicle-roi",
    "/photos",
    "/documents",
    "/staff-schedule",
  ].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

async function fetchOrderForResponse(id: string, workspaceId: string) {
  return prisma.order.findFirstOrThrow({
    where: { id, workspaceId, isArchived: false },
    include: {
      vehicle: {
        include: {
          owner: true,
          // Needed to show the fee this trip is actually priced at,
          // which is not the vehicle's current fee if the rate changed
          // after the trip started.
          cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
        },
      },
    },
  });
}

type OrderForResponse = Awaited<ReturnType<typeof fetchOrderForResponse>>;

function buildResponseOrder(order: OrderForResponse) {
  return {
    id: order.id,
    source: order.source,
    status: order.status,
    hasConflict: order.hasConflict,
    vehicleId: order.vehicleId,
    vehicleName: order.vehicle.nickname,
    vehiclePlateNumber: order.vehicle.plateNumber,
    ownerId: order.vehicle.ownerId,
    ownerName: order.vehicle.owner?.name ?? null,
    renterName: order.renterName,
    renterPhone: order.renterPhone,
    pickupDatetime: order.pickupDatetime.toISOString(),
    returnDatetime: order.returnDatetime.toISOString(),
    totalPrice: order.totalPrice,
    depositAmount: order.depositAmount,
    pickupLocation: order.pickupLocation,
    returnLocation: order.returnLocation,
    paymentMethod: order.paymentMethod,
    contractNumber: order.contractNumber,
    notes: order.notes,
    createdBy: order.createdBy,
    externalOrderId: order.externalOrderId,
    ownerLedgerSyncedAt: order.ownerLedgerSyncedAt?.toISOString() ?? null,
    // Two different numbers, and conflating them was a bug.
    //
    // `cleaningFee` is the car's fee as it stands today -- the value
    // the panel edits. `cleaningFeeOnTrip` is what THIS trip is
    // charged, which is the fee that was in force on the day it
    // started and is a different number whenever the price has changed
    // since. Returning the second one in the field that writes the
    // first made a fee typed against an old trip appear to vanish on
    // save: the rule was written from today, the trip resolved to the
    // older price, and the box came back showing that instead.
    cleaningFee: resolveCleaningFee(
      order.vehicle.cleaningFeeRules,
      new Date(),
      order.vehicle.cleaningFee,
    ).amount,
    // Every charge this trip carried beyond the rent. The importer has
    // always captured these; nothing ever showed them.
    feeLines: getOrderFeeLines(order.sourceMetadata),
    cleaningFeeOnTrip: resolveCleaningFee(
      order.vehicle.cleaningFeeRules,
      order.pickupDatetime,
      order.vehicle.cleaningFee,
    ).amount,
  };
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const parsed = orderUpdateSchema.parse(await request.json());
    const pickupDatetime = new Date(parsed.pickupDatetime);
    const returnDatetime = new Date(parsed.returnDatetime);

    if (
      Number.isNaN(pickupDatetime.getTime()) ||
      Number.isNaN(returnDatetime.getTime()) ||
      returnDatetime <= pickupDatetime
    ) {
      return NextResponse.json({ error: "INVALID_DATES" }, { status: 400 });
    }

    const existing = await prisma.order.findFirst({
      where: { id: orderId, workspaceId: workspace.id, isArchived: false },
    });

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: { id: parsed.vehicleId, workspaceId: workspace.id },
      select: { id: true },
    });

    if (!vehicle) {
      return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });
    }

    const order = await prisma.order.update({
      where: { id: existing.id },
      data: {
        vehicleId: parsed.vehicleId,
        renterName: parsed.renterName,
        renterPhone: parsed.renterPhone ?? null,
        pickupDatetime,
        returnDatetime,
        totalPrice: roundCurrencyAmount(parsed.totalPrice),
        depositAmount: roundCurrencyAmount(parsed.depositAmount),
        status: parsed.status,
        pickupLocation: parsed.pickupLocation ?? null,
        returnLocation: parsed.returnLocation ?? null,
        paymentMethod: parsed.paymentMethod ?? null,
        contractNumber: parsed.contractNumber ?? null,
        notes: parsed.notes ?? null,
      },
    });

    // A cleaning fee is a price on the car, not a line on this order,
    // so saving one writes a dated rule and then resyncs every trip it
    // now covers. Anchored on the trip's start date, so a trip already
    // under way keeps the fee it was booked under.
    if (parsed.cleaningFee != null && parsed.cleaningFeeFrom) {
      const effectiveFrom = new Date(`${parsed.cleaningFeeFrom}T12:00:00.000Z`);
      if (!Number.isNaN(effectiveFrom.getTime())) {
        const amount = roundCurrencyAmount(parsed.cleaningFee) ?? 0;
        await prisma.vehicleCleaningFeeRule.upsert({
          where: {
            vehicleId_effectiveFrom: { vehicleId: order.vehicleId, effectiveFrom },
          },
          update: { amount },
          create: {
            workspaceId: workspace.id,
            vehicleId: order.vehicleId,
            amount,
            effectiveFrom,
            createdBy: user.name,
          },
        });

        // Every trip on this car from that day on is repriced. Bounded
        // to that car and that date rather than resyncing the fleet.
        const affected = await prisma.order.findMany({
          where: {
            vehicleId: order.vehicleId,
            workspaceId: workspace.id,
            pickupDatetime: { gte: effectiveFrom },
          },
          select: { id: true },
        });
        for (const row of affected) {
          await syncOrderOwnerLedger(row.id);
        }
      }
    }

    await syncOrderOwnerLedger(order.id);
    await reconcileVehicleConflicts(order.vehicleId);
    if (existing.vehicleId !== order.vehicleId) {
      await reconcileVehicleConflicts(existing.vehicleId);
    }

    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "order_updated",
      entityType: "Order",
      entityId: order.id,
      metadata: {
        source: order.source,
        renterName: order.renterName,
        vehicleId: order.vehicleId,
      },
    });

    revalidateOrderSurfaces();
    const refreshed = await fetchOrderForResponse(order.id, workspace.id);
    return NextResponse.json({ order: buildResponseOrder(refreshed) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
    }

    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  try {
    const existing = await prisma.order.findFirst({
      where: { id: orderId, workspaceId: workspace.id, isArchived: false },
    });

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const archivedOrder = await prisma.order.update({
      where: { id: existing.id },
      data: {
        isArchived: true,
        status: OrderStatus.cancelled,
      },
    });

    await syncOrderOwnerLedger(archivedOrder.id);
    await reconcileVehicleConflicts(existing.vehicleId);
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "order_deleted",
      entityType: "Order",
      entityId: archivedOrder.id,
      metadata: {
        source: archivedOrder.source,
        vehicleId: archivedOrder.vehicleId,
        externalOrderId: archivedOrder.externalOrderId,
      },
    });

    revalidateOrderSurfaces();
    return NextResponse.json({ deletedId: archivedOrder.id, archivedId: archivedOrder.id });
  } catch {
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
}
