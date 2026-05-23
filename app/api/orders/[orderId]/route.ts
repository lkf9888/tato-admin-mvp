import { OrderStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
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
    include: { vehicle: { include: { owner: true } } },
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
